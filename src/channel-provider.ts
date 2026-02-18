import type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
} from "./types.js";

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

export const twitchChannelProvider: ChannelProvider = {
  id: "twitch",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
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
    await cmdCtx.reply(`Error executing ${prefix}${cmdName}: ${error}`);
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
      } catch {
        return false;
      }
    }
  }
  return false;
}
