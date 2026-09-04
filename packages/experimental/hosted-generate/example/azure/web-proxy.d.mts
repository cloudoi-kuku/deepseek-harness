// Declarations for web-proxy.mjs — see the note in launch-token.d.ts.

import type http from 'node:http'

export declare const server: http.Server

export declare function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>

export declare function authorized(req: http.IncomingMessage): boolean

export declare function wantsHtml(req: http.IncomingMessage): boolean

export declare function landingPage(): string

/** Null when the body is not a GitHub https clone URL. */
export declare function parseCloneRemote(body: string, contentType: string): string | null
