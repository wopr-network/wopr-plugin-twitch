import { describe, it, expect, vi, beforeEach } from "vitest";

// We must import the module functions before setting up mocks
// because channel-provider uses module-level state
import {
  twitchChannelProvider,
  setChatManager,
} from "../../src/channel-provider.js";
import type { ChannelCommand, ChannelMessageParser } from "../../src/types.js";

// Create a minimal mock chat manager
const mockChatManager = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendWhisper: vi.fn().mockResolvedValue(undefined),
  getBotUsername: vi.fn().mockReturnValue("testbot"),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

describe("twitchChannelProvider", () => {
  beforeEach(() => {
    // Reset state between tests
    // Unregister any commands/parsers from previous tests
    for (const cmd of twitchChannelProvider.getCommands()) {
      twitchChannelProvider.unregisterCommand(cmd.name);
    }
    for (const parser of twitchChannelProvider.getMessageParsers()) {
      twitchChannelProvider.removeMessageParser(parser.id);
    }
    vi.clearAllMocks();
    setChatManager(mockChatManager as never);
  });

  describe("registerCommand / unregisterCommand", () => {
    it("registers a command and makes it retrievable", () => {
      const cmd: ChannelCommand = {
        name: "ping",
        description: "Ping command",
        handler: vi.fn(),
      };
      twitchChannelProvider.registerCommand(cmd);
      expect(twitchChannelProvider.getCommands()).toContain(cmd);
    });

    it("unregisters a command", () => {
      const cmd: ChannelCommand = {
        name: "ping",
        description: "Ping command",
        handler: vi.fn(),
      };
      twitchChannelProvider.registerCommand(cmd);
      twitchChannelProvider.unregisterCommand("ping");
      expect(twitchChannelProvider.getCommands()).not.toContain(cmd);
    });

    it("getCommands returns all registered commands", () => {
      const cmd1: ChannelCommand = { name: "a", description: "A", handler: vi.fn() };
      const cmd2: ChannelCommand = { name: "b", description: "B", handler: vi.fn() };
      twitchChannelProvider.registerCommand(cmd1);
      twitchChannelProvider.registerCommand(cmd2);
      const cmds = twitchChannelProvider.getCommands();
      expect(cmds).toContain(cmd1);
      expect(cmds).toContain(cmd2);
    });
  });

  describe("addMessageParser / removeMessageParser", () => {
    it("adds a message parser", () => {
      const parser: ChannelMessageParser = {
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      };
      twitchChannelProvider.addMessageParser(parser);
      expect(twitchChannelProvider.getMessageParsers()).toContain(parser);
    });

    it("removes a message parser", () => {
      const parser: ChannelMessageParser = {
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      };
      twitchChannelProvider.addMessageParser(parser);
      twitchChannelProvider.removeMessageParser("test-parser");
      expect(twitchChannelProvider.getMessageParsers()).not.toContain(parser);
    });
  });

  describe("send", () => {
    it("calls chatManager.sendMessage with correct channel format", async () => {
      await twitchChannelProvider.send("twitch:mychannel", "hello");
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith("#mychannel", "hello");
    });

    it("throws if chatManager is not set", async () => {
      setChatManager(null);
      await expect(twitchChannelProvider.send("twitch:mychannel", "hi")).rejects.toThrow("Twitch chat not connected");
    });
  });

  describe("getBotUsername", () => {
    it("delegates to chatManager", () => {
      expect(twitchChannelProvider.getBotUsername()).toBe("testbot");
    });

    it("returns unknown when chatManager is null", () => {
      setChatManager(null);
      expect(twitchChannelProvider.getBotUsername()).toBe("unknown");
    });
  });
});
