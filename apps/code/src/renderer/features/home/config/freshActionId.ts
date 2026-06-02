// Next unused `action_N` id given the ids already in a situation's binding list.
export function freshActionId(existing: string[]): string {
  let n = 1;
  while (existing.includes(`action_${n}`)) n++;
  return `action_${n}`;
}
