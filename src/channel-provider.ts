import type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
} from "@wopr-network/plugin-types";

export interface ChannelNotificationPayload {
  type: string;
  from?: string;
  pubkey?: string;
  encryptPub?: string;
  signature?: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface ChannelNotificationCallbacks {
  onAccept?: () => Promise<void>;
  onDeny?: () => Promise<void>;
}

// Minimal interface for what channel-provider needs from TwitchChatManager
interface ChatManagerLike {
  sendMessage(channel: string, text: string): Promise<void>;
  getBotUsername(): string;
}

let chatManager: ChatManagerLike | null = null;

export function setChatManager(mgr: ChatManagerLike | null): void {
  chatManager = mgr;
}

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

export const twitchChannelProvider: ChannelProvider & {
  sendNotification?: (
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ) => Promise<void>;
} = {
  id: "twitch",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name.toLowerCase(), cmd);
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name.toLowerCase());
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channelId: string, content: string): Promise<void> {
    if (!chatManager) throw new Error("Twitch chat not connected");
    // channelId format: "twitch:<channel>" — extract channel name
    const channel = channelId.replace(/^twitch:/, "");
    await chatManager.sendMessage(`#${channel}`, content);
  },

  getBotUsername(): string {
    return chatManager?.getBotUsername() ?? "unknown";
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "friend-request") return;
    if (!chatManager) throw new Error("Twitch chat not connected");

    const channel = channelId.replace(/^twitch:/, "");
    const fromLabel = payload.from || payload.pubkey || "unknown peer";

    await chatManager.sendMessage(
      `#${channel}`,
      `@${channel} Friend request from ${fromLabel}. Reply !accept or !deny`,
    );

    const parserId = `notif-fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const parser: ChannelMessageParser = {
      id: parserId,
      pattern: (msg: string) => {
        const lower = msg.trim().toLowerCase();
        return lower === "!accept" || lower === "!deny";
      },
      handler: async (ctx: ChannelMessageContext) => {
        if (ctx.sender.toLowerCase() !== channel.toLowerCase()) return;

        const action = ctx.content.trim().toLowerCase();

        registeredParsers.delete(parserId);

        if (action === "!accept") {
          await callbacks?.onAccept?.();
          await ctx.reply(`Friend request from ${fromLabel} accepted.`);
        } else if (action === "!deny") {
          await callbacks?.onDeny?.();
          await ctx.reply(`Friend request from ${fromLabel} denied.`);
        }
      },
    };

    registeredParsers.set(parser.id, parser);
  },
};

/**
 * Check if a message matches a registered command and handle it.
 * Returns true if handled.
 */
export async function handleRegisteredCommand(
  channel: string,
  sender: string,
  text: string,
  prefix: string,
): Promise<boolean> {
  if (!text.startsWith(prefix)) return false;

  const parts = text.slice(prefix.length).split(/\s+/);
  const cmdName = parts[0]?.toLowerCase();
  if (!cmdName) return false;
  const args = parts.slice(1);

  const cmd = registeredCommands.get(cmdName);
  if (!cmd) return false;

  const cleanChannel = channel.replace(/^#/, "");
  const cmdCtx: ChannelCommandContext = {
    channel: `twitch:${cleanChannel}`,
    channelType: "twitch",
    sender,
    args,
    reply: async (msg: string) => {
      if (chatManager) await chatManager.sendMessage(channel, msg);
    },
    getBotUsername: () => chatManager?.getBotUsername() ?? "unknown",
  };

  try {
    await cmd.handler(cmdCtx);
    return true;
  } catch (error) {
    console.error(`[twitch] Error executing command ${prefix}${cmdName}:`, error);
    await cmdCtx.reply(`Sorry, an error occurred while executing that command.`);
    return true;
  }
}

/**
 * Check if a message matches any registered parser.
 * Returns true if handled.
 */
export async function handleRegisteredParsers(channel: string, sender: string, text: string): Promise<boolean> {
  const cleanChannel = channel.replace(/^#/, "");
  for (const parser of registeredParsers.values()) {
    let matches = false;
    if (typeof parser.pattern === "function") {
      matches = parser.pattern(text);
    } else {
      parser.pattern.lastIndex = 0;
      matches = parser.pattern.test(text);
    }

    if (matches) {
      const msgCtx: ChannelMessageContext = {
        channel: `twitch:${cleanChannel}`,
        channelType: "twitch",
        sender,
        content: text,
        reply: async (msg: string) => {
          if (chatManager) await chatManager.sendMessage(channel, msg);
        },
        getBotUsername: () => chatManager?.getBotUsername() ?? "unknown",
      };

      try {
        await parser.handler(msgCtx);
        return true;
      } catch (err) {
        console.error(`[twitch] Message parser "${parser.id}" threw an unhandled error:`, err);
        return false;
      }
    }
  }
  return false;
}
