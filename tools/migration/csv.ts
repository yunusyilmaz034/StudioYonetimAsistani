import { readFileSync } from 'node:fs'

import { readBulutGymMembers as parse, type MemberImportRow } from '@studio/core'

export { MissingColumnError } from '@studio/core'

// The break-glass script reads from disk; the screen reads from a browser file input. The PARSER is
// the same one, in the domain — see `members/domain/import-csv.ts`.
export function readBulutGymMembers(path: string): readonly MemberImportRow[] {
  return parse(readFileSync(path, 'utf8'))
}
