/** A completed old sync must not switch back to an account that already left. */
export async function switchOwnerAfterSync(pending, ownerId, { isCurrent, switchOwner }) {
  try {
    await pending;
  } catch {
    // Switching accounts intentionally aborts the previous account's sync.
  }
  if (!isCurrent()) return false;
  await switchOwner(ownerId);
  return true;
}

/** Reading conflict details can outlive sign-out or a switch to another user. */
export async function refreshCurrentConflict({ readRemote, assertCurrent, showRemote, showConflict }) {
  assertCurrent();
  try {
    const fresh = await readRemote();
    assertCurrent();
    showRemote(fresh);
  } catch {
    // A failed read keeps the last verified snapshot. A stale account cannot
    // publish either that snapshot or its conflict status into the new account.
    assertCurrent();
  }
  assertCurrent();
  showConflict();
}
