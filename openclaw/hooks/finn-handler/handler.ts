// finn-handler: message:received hook (no-op)
// All WhatsApp handling is done via the before_agent_reply plugin hook
// registered in the finance-agent plugin (plugin/src/index.ts).
// This file intentionally does nothing to avoid duplicate replies.
const handler = async (_event: any) => {
  return
}
export default handler
