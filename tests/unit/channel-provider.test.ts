import { describe, it, expect, vi, beforeEach } from "vitest";

// We must import the module functions before setting up mocks
// because channel-provider uses module-level state
import {
  twitchChannelProvider,
  setChatManager,
} from "../../src/channel-provider.js";
import type {
  ChannelCommand,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
} from "../../src/types.js";

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

  describe("sendNotification", () => {
    it("ignores non-friend-request payload types", async () => {
      const payload: ChannelNotificationPayload = { type: "other" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      expect(mockChatManager.sendMessage).not.toHaveBeenCalled();
    });

    it("sends a mention message for friend-request payload", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith(
        "#mychannel",
        expect.stringContaining("alice"),
      );
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith(
        "#mychannel",
        expect.stringContaining("!accept"),
      );
    });

    it("registers a one-shot message parser for owner response", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const parsers = twitchChannelProvider.getMessageParsers();
      expect(parsers.some((p) => p.id.startsWith("notif-fr-"))).toBe(true);
    });

    it("fires onAccept callback when owner replies !accept", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      const callbacks: ChannelNotificationCallbacks = { onAccept, onDeny };
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, callbacks);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;
      expect(parser).toBeDefined();

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: "!accept",
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onAccept).toHaveBeenCalledOnce();
      expect(onDeny).not.toHaveBeenCalled();
      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("fires onDeny callback when owner replies !deny", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      const callbacks: ChannelNotificationCallbacks = { onAccept, onDeny };
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, callbacks);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: "!deny",
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onDeny).toHaveBeenCalledOnce();
      expect(onAccept).not.toHaveBeenCalled();
      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("works with no callbacks provided", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: "!accept",
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("throws if chatManager is not set", async () => {
      setChatManager(null);
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await expect(
        twitchChannelProvider.sendNotification!("twitch:mychannel", payload),
      ).rejects.toThrow("Twitch chat not connected");
    });
  });
});
