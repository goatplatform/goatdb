import { cli } from './development.ts';
import { isBrowser, isDeno, isNode } from './common.ts';
import { getEnvVar, getOS, normalizeNodePlatform } from './os.ts';
import { log } from '../logging/log.ts';

export type SystemInfo = {
  hardware: {
    cpu: string | null;
    memory: string | null;
    storage: string;
  };
  runtime: {
    platform: string | null;
    runtime: string | null;
    version: string | null;
  };
};

export async function getSystemInfo(): Promise<SystemInfo> {
  const hardwareOverride = getEnvVar('GOATDB_SYSTEM_HARDWARE');
  if (hardwareOverride) {
    try {
      return {
        hardware: JSON.parse(hardwareOverride),
        runtime: getRuntimeInfo(),
      };
    } catch {
      log({
        severity: 'WARNING',
        error: 'SchemaValidationError',
        message: '[GoatDB] Invalid JSON in GOATDB_SYSTEM_HARDWARE, ignoring',
      });
    }
  }
  if (isBrowser()) {
    return await getBrowserSystemInfo();
  } else {
    return await getServerSystemInfo();
  }
}

function getRuntimeInfo(): SystemInfo['runtime'] {
  if (isBrowser()) {
    const ua = navigator.userAgent;
    let version = null;
    if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/(\d+\.\d+)/);
      version = match ? `Chrome ${match[1]}` : null;
    } else if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/(\d+\.\d+)/);
      version = match ? `Firefox ${match[1]}` : null;
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      const match = ua.match(/Version\/(\d+\.\d+)/);
      version = match ? `Safari ${match[1]}` : null;
    }
    return {
      platform: ua,
      runtime: 'browser',
      version: version || ua.split(' ').pop() || null,
    };
  } else if (isDeno()) {
    return {
      platform: `${Deno.build.os} ${Deno.build.arch}`,
      runtime: 'deno',
      version: Deno.version.deno,
    };
  } else if (isNode()) {
    const os = require('node:os');
    const process = require('node:process');
    return {
      platform: `${normalizeNodePlatform(os.platform())} ${os.arch()}`,
      runtime: 'node',
      version: process.version,
    };
  }
  return { platform: null, runtime: null, version: null };
}

async function getServerSystemInfo(): Promise<SystemInfo> {
  const [cpuResult, memResult, diskResult] = await Promise.allSettled([
    getCPUInfo(),
    getMemoryInfo(),
    getDiskInfo(),
  ]);

  return {
    hardware: {
      cpu: cpuResult.status === 'fulfilled' ? cpuResult.value : null,
      memory: memResult.status === 'fulfilled' ? memResult.value : null,
      storage: diskResult.status === 'fulfilled' && diskResult.value
        ? diskResult.value
        : 'Generic SSD',
    },
    runtime: getRuntimeInfo(),
  };
}

async function getBrowserSystemInfo(): Promise<SystemInfo> {
  const cores = navigator.hardwareConcurrency;
  const ua = navigator.userAgent;
  let cpuInfo: string | null = cores ? `${cores} cores` : null;

  // Try Client Hints first (Chrome/Edge) for accurate arch on Apple Silicon
  try {
    const uaData = (navigator as any).userAgentData;
    if (uaData?.getHighEntropyValues) {
      const hints = await uaData.getHighEntropyValues(['architecture']);
      const arch: string = hints.architecture ?? '';
      if (arch === 'arm' && ua.includes('Mac')) {
        cpuInfo = cores ? `Apple Silicon (${cores} cores)` : 'Apple Silicon';
      } else if (arch === 'x86') {
        cpuInfo = cores ? `Intel CPU (${cores} cores)` : 'Intel CPU';
      } else if (arch) {
        cpuInfo = cores ? `${arch} CPU (${cores} cores)` : `${arch} CPU`;
      }
    } else {
      // Fallback: check Apple/Mac before Intel to avoid UA Reduction misdetect
      if (ua.includes('Apple') && ua.includes('Mac')) {
        cpuInfo = cores ? `Apple Silicon (${cores} cores)` : 'Apple Silicon';
      } else if (ua.includes('Intel')) {
        cpuInfo = cores ? `Intel CPU (${cores} cores)` : 'Intel CPU';
      }
    }
  } catch {
    // Restrictive permissions policy — fall back to UA string
    if (ua.includes('Apple') && ua.includes('Mac')) {
      cpuInfo = cores ? `Apple Silicon (${cores} cores)` : 'Apple Silicon';
    } else if (ua.includes('Intel')) {
      cpuInfo = cores ? `Intel CPU (${cores} cores)` : 'Intel CPU';
    }
  }

  // Try to get memory info (limited browser support)
  let memoryInfo = null;
  if ('deviceMemory' in navigator) {
    // @ts-ignore - deviceMemory is not in standard types but may exist
    memoryInfo = `${navigator.deviceMemory}GB`;
  } else if (
    'memory' in performance && 'totalJSHeapSize' in (performance as any).memory
  ) {
    // Estimate from JS heap limit (very rough approximation)
    const heapMB = Math.round(
      (performance as any).memory.totalJSHeapSize / (1024 * 1024),
    );
    if (heapMB > 100) {
      memoryInfo = `~${Math.round(heapMB / 500)}GB (estimated)`;
    }
  }

  return {
    hardware: {
      cpu: cpuInfo,
      memory: memoryInfo,
      storage: 'OPFS',
    },
    runtime: getRuntimeInfo(),
  };
}

async function getCPUInfo(): Promise<string | null> {
  try {
    if (isNode()) {
      return require('node:os').cpus()[0]?.model ?? null;
    } else if (Deno.build?.os === 'darwin') {
      const { result, exitCode } = await cli(
        'sysctl',
        '-n',
        'machdep.cpu.brand_string',
      );
      return exitCode === 0 ? result.trim() : null;
    } else if (Deno.build?.os === 'linux') {
      const { result, exitCode } = await cli('lscpu');
      const match = result.match(/Model name:\s*(.+)/);
      return match ? match[1].trim() : null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

async function getMemoryInfo(): Promise<string | null> {
  try {
    if (isNode()) {
      const bytes = require('node:os').totalmem();
      return `${Math.round(bytes / 1024 ** 3)}GB`;
    } else if (Deno.build?.os === 'darwin') {
      const { result, exitCode } = await cli('sysctl', '-n', 'hw.memsize');
      if (exitCode === 0) {
        const bytes = parseInt(result.trim());
        return `${Math.round(bytes / (1024 ** 3))}GB`;
      }
    } else if (Deno.build?.os === 'linux') {
      const { result, exitCode } = await cli('cat', '/proc/meminfo');
      if (exitCode === 0) {
        const match = result.match(/MemTotal:\s*(\d+)\s*kB/);
        if (match) {
          const kb = parseInt(match[1]);
          return `${Math.round(kb / (1024 ** 2))}GB`;
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

async function getDiskInfo(): Promise<string | null> {
  try {
    const os = getOS();
    if (os === 'darwin') {
      // Try NVMe first
      const { result: nvmeResult, exitCode: nvmeCode } = await cli(
        'system_profiler',
        'SPNVMeDataType',
      );
      if (nvmeCode === 0 && nvmeResult.includes('Model:')) {
        const match = nvmeResult.match(/Model:\s*(.+)/m);
        if (match) return `NVMe SSD - ${match[1].trim()}`;
      }

      // Fallback to general storage
      const { result, exitCode } = await cli(
        'system_profiler',
        'SPStorageDataType',
      );
      if (exitCode === 0) {
        const match = result.match(/Model:\s*(.+)/m);
        if (match) return `SSD - ${match[1].trim()}`;
      }
    } else if (os === 'linux') {
      // Try NVMe first
      const { result: nvmeResult, exitCode: nvmeCode } = await cli(
        'nvme',
        'list',
      );
      if (nvmeCode === 0 && nvmeResult.includes('/dev/nvme')) {
        const lines = nvmeResult.split('\n');
        for (const line of lines) {
          if (line.includes('/dev/nvme') && !line.includes('Node')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 2) {
              return `NVMe SSD - ${parts[2]}`;
            }
          }
        }
      }

      // Fallback to lsblk for SSDs
      const { result, exitCode } = await cli(
        'lsblk',
        '-d',
        '-o',
        'NAME,MODEL,ROTA',
      );
      if (exitCode === 0) {
        const lines = result.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && parts[2] === '0' && parts[1] !== 'MODEL') {
            return `SSD - ${parts[1]}`;
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}
