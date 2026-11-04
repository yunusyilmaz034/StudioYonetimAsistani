// IG-2c — `content_post.edit_requested` → run the `content-render` Cloud Run job for that post.
// The functions' service account may run jobs in this project already (no IAM change). The job finds
// the request on the post itself; a duplicate delivery runs it twice and the second result is refused
// by the domain (it answers a request that is already answered), so at-least-once is safe.
import * as logger from 'firebase-functions/logger'

export const RENDER_JOB = 'content-render'
export const RENDER_REGION = 'europe-west1'

export function renderJobRequest(project: string, studioId: string, postId: string): { url: string; body: unknown } {
  return {
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${RENDER_REGION}/jobs/${RENDER_JOB}:run`,
    body: { overrides: { containerOverrides: [{ env: [{ name: 'STUDIO_ID', value: studioId }, { name: 'POST_ID', value: postId }] }] } },
  }
}

async function accessToken(): Promise<string> {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })
  if (!res.ok) throw new Error(`metadata token ${res.status}`)
  return String(((await res.json()) as { access_token?: string }).access_token ?? '')
}

export async function startContentRender(studioId: string, postId: string): Promise<void> {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? ''
  if (!project) throw new Error('project id missing')
  const { url, body } = renderJobRequest(project, studioId, postId)
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`run job ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  logger.info('content-render started', { studioId, postId })
}
