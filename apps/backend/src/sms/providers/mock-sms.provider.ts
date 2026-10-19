import { randomUUID } from 'node:crypto';
import type { SmsMessageInput, SmsProvider } from '../sms.types.js';

export interface MockSmsMessage {
  to: string;
  text: string;
  sentAt: Date;
}

const MAX_MESSAGES = 200;

/** In-memory inbox for development and tests (forbidden in production). */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly inbox: MockSmsMessage[] = [];

  send(message: SmsMessageInput): Promise<{ providerMessageId: string }> {
    this.inbox.push({ to: message.to, text: message.text, sentAt: new Date() });
    if (this.inbox.length > MAX_MESSAGES)
      this.inbox.splice(0, this.inbox.length - MAX_MESSAGES);
    return Promise.resolve({ providerMessageId: `mock-${randomUUID()}` });
  }

  messages(): ReadonlyArray<MockSmsMessage> {
    return [...this.inbox];
  }

  lastTo(phone: string): MockSmsMessage | undefined {
    return this.inbox.findLast((message) => message.to === phone);
  }

  clear(): void {
    this.inbox.length = 0;
  }
}
