import { checkFnosUpdateStatus } from '../services/fnos-update'

export async function fnosUpdateStatus(ctx: any) {
  ctx.status = 200
  ctx.body = await checkFnosUpdateStatus()
}
