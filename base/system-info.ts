import { cli } from './development.ts';
import { isBrowser, isDeno, isNode } from './common.ts';

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
  if (isBrowser()) {
    return getBrowserSystemInfo();
  } else {
    return await getServerSystemInfo();
  }
}

async function getServerSystemInfo(): Promise<SystemInfo> {
  const [cpuResult, memResult, diskResult] = await Promise.allSettled([
    getCPUInfo(),
    getMemoryInfo(),
    getDiskInfo(),
  ]);

  let platform = 'unknown';
  let runtime = 'unknown';
  let version = null;

  if (isDeno()) {
    platform = `${Deno.build.os} ${Deno.build.arch}`;
    runtime = 'deno';
    version = Deno.version.deno;
  } else if (isNode()) {
    const os = require('node:os');
    const process = require('node:process');
    platform = `${os.platform()} ${os.arch()}`;
    runtime = 'node';
    version = process.version;
  }

  return {
    hardware: {
      cpu: cpuResult.status === 'fulfilled' ? cpuResult.value : null,
      memory: memResult.status === 'fulfilled' ? memResult.value : null,
      storage: diskResult.status === 'fulfilled' && diskResult.value
        ? diskResult.value
        : 'Generic SSD',
    },
    runtime: {
      platform,
      runtime,
      version,
    },
  };
}

function getBrowserSystemInfo(): SystemInfo {
  // Extract CPU info from user agent or use core count
  let cpuInfo = navigator.hardwareConcurrency
    ? `${navigator.hardwareConcurrency} cores`
    : null;
  
  // Try to get more CPU details from user agent
  const ua = navigator.userAgent;
  if (ua.includes('Intel')) {
    cpuInfo = navigator.hardwareConcurrency 
      ? `Intel CPU (${navigator.hardwareConcurrency} cores)` 
      : 'Intel CPU';
  } else if (ua.includes('Apple') && ua.includes('Mac')) {
    cpuInfo = navigator.hardwareConcurrency 
      ? `Apple Silicon (${navigator.hardwareConcurrency} cores)` 
      : 'Apple Silicon';
  }

  // Try to get memory info (limited browser support)
  let memoryInfo = null;
  if ('deviceMemory' in navigator) {
    // @ts-ignore - deviceMemory is not in standard types but may exist
    memoryInfo = `${navigator.deviceMemory}GB`;
  } else if ('memory' in performance && 'totalJSHeapSize' in (performance as any).memory) {
    // Estimate from JS heap limit (very rough approximation)
    const heapMB = Math.round((performance as any).memory.totalJSHeapSize / (1024 * 1024));
    if (heapMB > 100) {
      memoryInfo = `~${Math.round(heapMB / 500)}GB (estimated)`;
    }
  }

  // Extract browser version more precisely
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
    hardware: {
      cpu: cpuInfo,
      memory: memoryInfo,
      storage: 'OPFS',
    },
    runtime: {
      platform: navigator.userAgent,
      runtime: 'browser',
      version: version || navigator.userAgent.split(' ').pop() || null,
    },
  };
}

async function getCPUInfo(): Promise<string | null> {
  try {
    if (Deno.build?.os === 'darwin') {
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
    if (Deno.build?.os === 'darwin') {
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
    if (Deno.build?.os === 'darwin') {
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
    } else if (Deno.build?.os === 'linux') {
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
