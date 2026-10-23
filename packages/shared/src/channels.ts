// 슬랙(Incoming Webhook)·이메일(SMTP)로 실제로 보내는 부분. F205 내보내기와 F207 알림이 함께 쓴다
import nodemailer from "nodemailer";

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** 기본 받는 사람 (보낼 때 바꿀 수 있다) */
  to: string[];
}
export interface SlackConfig {
  webhookUrl: string;
}

export interface EmailMessage {
  subject: string;
  text: string;
  html?: string;
}

export async function postSlack(config: SlackConfig, text: string): Promise<void> {
  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`슬랙 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function sendEmail(config: EmailConfig, to: string[], msg: EmailMessage): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  await transport.sendMail({ from: config.from, to, subject: msg.subject, text: msg.text, html: msg.html });
}
