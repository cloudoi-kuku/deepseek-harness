/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { GitWorkspaceStatusView, WorkspaceSourceView, WorkspaceView } from './workspace.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'

export { workspaceIdSchema } from './sessions.schema.ts'

/** Discriminated checkout origin on WorkspaceView. */
export const workspaceSourceViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: z.string() }),
  z.object({
    kind: z.literal('git'),
    provider: z.enum(['github', 'generic']),
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    remoteUrl: z.string(),
    checkoutPath: z.string(),
    credentialId: z.string().optional(),
  }),
]) satisfies z.ZodType<Wire<WorkspaceSourceView>>

/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
  workspaceId: workspaceIdSchema,
  path: z.string(),
  title: z.string(),
  source: workspaceSourceViewSchema.optional(),
  owner: z.object({ tenantId: z.string(), userId: z.string() }).optional(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<WorkspaceView>>

/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.list'>>>

/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
  items: z.array(workspaceViewSchema),
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.list'>>>

/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.create'>>>

/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.create'>>>

/** workspace.createGit request payload: Git remote and checkout parent. */
export const workspaceCreateGitRequestSchema = z.object({
  remoteUrl: z.string(),
  checkoutParent: z.string().optional(),
  branch: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  credentialId: z.string().optional(),
  title: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.createGit'>>>

/** workspace.createGit response value. */
export const workspaceCreateGitValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.createGit'>>>

/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.rename'>>>

/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.rename'>>>

/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.delete'>>>

/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.delete'>>>

/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertBefore'>>>

/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
  workspaceIds: z.array(workspaceIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertBefore'>>>

/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertSessionBefore'>>>

/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertSessionBefore'>>>

/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.archiveSession'>>>

/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.archiveSession'>>>

/** Git working-copy status on the wire. */
export const gitWorkspaceStatusViewSchema = z.object({
  branch: z.string(),
  dirty: z.boolean(),
  ahead: z.number(),
  behind: z.number(),
  conflicted: z.array(z.string()),
  lastPushedAt: z.string().optional(),
}) satisfies z.ZodType<Wire<GitWorkspaceStatusView>>

/** workspace.gitStatus request payload. */
export const workspaceGitStatusRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.gitStatus'>>>

/** workspace.gitStatus response value. */
export const workspaceGitStatusValueSchema = z.object({
  status: gitWorkspaceStatusViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.gitStatus'>>>

/** workspace.gitCommit request payload. */
export const workspaceGitCommitRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  message: z.string(),
}).refine(
  payload => payload.message.trim() !== '',
  { message: 'workspace.gitCommit requires a non-blank message' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.gitCommit'>>>

/** workspace.gitCommit response value. */
export const workspaceGitCommitValueSchema = z.object({
  commit: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.gitCommit'>>>

/** workspace.gitPush request payload. */
export const workspaceGitPushRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.gitPush'>>>

/** workspace.gitPush response value. */
export const workspaceGitPushValueSchema = z.object({
  pushed: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.gitPush'>>>

/** workspace.gitPull request payload. */
export const workspaceGitPullRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.gitPull'>>>

/** workspace.gitPull response value. */
export const workspaceGitPullValueSchema = z.object({
  conflicted: z.array(z.string()),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.gitPull'>>>

/** workspace.gitCheckoutBranch request payload. */
export const workspaceGitCheckoutBranchRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  branch: z.string(),
}).refine(
  payload => payload.branch.trim() !== '',
  { message: 'workspace.gitCheckoutBranch requires a non-blank branch' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.gitCheckoutBranch'>>>

/** workspace.gitCheckoutBranch response value. */
export const workspaceGitCheckoutBranchValueSchema = z.object({
  branch: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.gitCheckoutBranch'>>>
