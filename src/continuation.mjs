export async function driveContinuation(
  session,
  controller,
  id,
  stop = () => false,
) {
  while (!stop()) {
    const decision = await controller.settle(id);
    if (!decision.continue) return decision;
    await session.sendCustomMessage(
      {
        customType: "goal-controller",
        content: JSON.stringify(decision),
        display: true,
      },
      { triggerTurn: true },
    );
  }
  return { continue: false, reason: "interrupted" };
}
