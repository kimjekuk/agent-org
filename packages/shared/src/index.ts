// web·worker 공용 코드. db/(1-A), llm/(1-B), crypto·events는 해당 단계에서 추가한다.

export const APP_NAME = "AgentOrg";

/** BullMQ 큐 이름. web이 작업을 넣고 worker가 처리한다. */
export const AGENT_QUEUE = "agent";
