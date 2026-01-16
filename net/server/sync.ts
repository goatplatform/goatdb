import { mapIterable } from '../../base/common.ts';
import {
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
} from '../../base/core-types/encoding/json.ts';
import type {
  JSONArray,
  JSONObject,
  ReadonlyJSONObject,
} from '../../base/interfaces.ts';
import type { Session } from '../../db/session.ts';
import type { Commit } from '../../repo/commit.ts';
import { getGoatConfig } from '../../base/config.ts';
import type { RepoClient } from '../client.ts';
import { SyncMessage } from '../message.ts';
import { kSyncConfigServer, syncConfigGetCycles } from '../sync-scheduler.ts';
import { requireSignedUser } from './auth.ts';
import type { Endpoint, ServerServices } from './server.ts';
import { getRequestPath } from './utils.ts';
import { GoatRequest } from './http-compat.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { ServeHandlerInfo } from './http-compat.ts';

export class SyncEndpoint<US extends Schema> implements Endpoint<US> {
  filter(
    _services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): boolean {
    if (req.method !== 'POST') {
      return false;
    }
    return getRequestPath(req) === '/batch-sync';
  }

  processRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
  ): Promise<Response> {
    if (!req.body) {
      return Promise.resolve(
        new Response(null, {
          status: 400,
        }),
      );
    }
    if (getRequestPath(req) === '/batch-sync') {
      return this.processBatchSyncRequest(services, req, info);
    }
    return Promise.resolve(new Response(null, { status: 400 }));
  }

  async processBatchSyncRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): Promise<Response> {
    const encodedRequests = await req.json();
    if (!(encodedRequests instanceof Array)) {
      return Promise.resolve(new Response(null, { status: 400 }));
    }
    const sig = req.headers.get('X-Goat-Sig');
    if (!sig) {
      return Promise.resolve(new Response(null, { status: 400 }));
    }
    const [_userId, _userRecord, userSession] = await requireSignedUser(
      services,
      sig,
      'anonymous',
    );
    const results: JSONArray = [];
    for (const r of encodedRequests) {
      const { path, msg } = r;
      results.push({
        path,
        res: await this.doSync(services, path, userSession, msg),
      });
    }
    const respJsonStr = JSON.stringify(results);
    return new Response(respJsonStr);
  }

  private async doSync(
    services: ServerServices<US>,
    path: string,
    userSession: Session,
    json: JSONObject,
  ): Promise<JSONObject> {
    return await this._handleSyncRequestAfterAuth(
      services,
      json,
      async (values) =>
        (
          await (await services.db.open(path)).persistCommits(values)
        ).length,
      async () =>
        mapIterable(
          (await services.db.open(path)).commits(userSession),
          (c) => [c.id, c],
        ),
      async () => (await services.db.open(path)).numberOfCommits(userSession),
      services.db.clientsForRepo(path),
      true,
      false,
      // path.startsWith('/sys/'),
    );
  }

  private async _handleSyncRequestAfterAuth(
    services: ServerServices<US>,
    msgJSON: JSONObject,
    persistCommits: (commits: Commit[]) => Promise<number>,
    fetchAll: () => Promise<Iterable<[string, Commit]>>,
    getLocalCount: () => Promise<number>,
    replicas: Iterable<RepoClient> | undefined,
    includeMissing: boolean,
    lowAccuracy: boolean,
  ): Promise<ReadonlyJSONObject> {
    const decoder = JSONCyclicalDecoder.get(msgJSON);
    const msg = new SyncMessage(
      {
        decoder,
        orgId: services.orgId,
      },
      services.db.registry,
    );
    decoder.finalize();
    let syncCycles = syncConfigGetCycles(kSyncConfigServer);
    if (msg.values.length > 0) {
      if ((await persistCommits(msg.values)) > 0) {
        // If we got a new commit from our client, we increase our filter's
        // accuracy to the maximum to avoid false-leaves at the tip of the
        // commit graph.
        syncCycles = 1;
        if (replicas) {
          // Sync changes with replicas
          for (const c of replicas) {
            c.touch();
          }
        }
      }
    }

    const syncResp = SyncMessage.build(
      msg.filter,
      await fetchAll(),
      await getLocalCount(),
      msg.size,
      syncCycles,
      services.orgId,
      services.db.registry,
      // Don't return new commits to old clients
      includeMissing && msg.buildVersion >= getGoatConfig().version,
      lowAccuracy,
    );

    const encodedResp = JSONCyclicalEncoder.serialize(syncResp);
    msg.filter.reuse();
    syncResp.filter.reuse();
    return encodedResp;
  }
}
