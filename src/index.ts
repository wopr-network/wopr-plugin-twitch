import { RefreshingAuthProvider } from "@twurple/auth";
import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { setChatManager, twitchChannelProvider } from "./channel-provider.js";
import { TwitchChatManager } from "./chat-client.js";
import { TwitchEventSubManager } from "./eventsub.js";
import type { TwitchConfig } from "./types.js";

let pluginCtx: WOPRPluginContext | null = null;
let chatManager: TwitchChatManager | null = null;
let eventSubManager: TwitchEventSubManager | null = null;

const configSchema: ConfigSchema = {
  title: "Twitch Integration",
  description: "Configure Twitch bot integration with chat, whispers, and channel points",
  fields: [
    {
      name: "clientId",
      type: "text",
      label: "Client ID",
      placeholder: "Twitch Application Client ID",
      required: true,
      description: "From the Twitch Developer Console",
    },
    {
      name: "clientSecret",
      type: "password",
      label: "Client Secret",
      placeholder: "Twitch Application Client Secret",
      required: true,
      description: "From the Twitch Developer Console",
    },
    {
      name: "accessToken",
      type: "password",
      label: "Access Token",
      placeholder: "OAuth Access Token",
      required: true,
      description: "OAuth token with chat:read, chat:edit scopes",
    },
    {
      name: "refreshToken",
      type: "password",
      label: "Refresh Token",
      placeholder: "OAuth Refresh Token",
      description: "For automatic token refresh",
    },
    {
      name: "channels",
      type: "text",
      label: "Channels",
      placeholder: "channel1, channel2",
      required: true,
      description: "Comma-separated list of Twitch channels to join",
    },
    {
      name: "commandPrefix",
      type: "text",
      label: "Command Prefix",
      placeholder: "!",
      description: "Prefix for bot commands (default: !)",
    },
    {
      name: "broadcasterId",
      type: "text",
      label: "Broadcaster User ID",
      placeholder: "123456789",
      description: "Your Twitch user ID (required for channel points)",
    },
    {
      name: "enableWhispers",
      type: "boolean",
      label: "Enable Whispers",
      description: "Allow private whisper messages (default: true)",
    },
    {
      name: "enableChannelPoints",
      type: "boolean",
      label: "Enable Channel Points",
      description: "Listen for channel point redemptions (requires broadcasterId)",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "Whisper Policy",
      description: "How to handle incoming whispers",
      options: [
        { value: "open", label: "Open (respond to all whispers)" },
        { value: "disabled", label: "Disabled (ignore whispers)" },
      ],
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-twitch",
  version: "1.0.0",
  description: "Twitch chat integration with whispers and channel point redemptions",

  manifest: {
    name: "@wopr-network/wopr-plugin-twitch",
    version: "1.0.0",
    description: "Twitch chat integration with whispers and channel point redemptions",
    capabilities: ["channel"],
    provides: {
      capabilities: [{ type: "channel", id: "twitch", displayName: "Twitch", tier: "byok" }],
    },
    requires: {
      env: [],
      network: { outbound: true, hosts: ["irc-ws.chat.twitch.tv", "api.twitch.tv"] },
    },
    category: "communication",
    tags: ["twitch", "chat", "streaming", "channel-points"],
    icon: "🎮",
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 10_000,
    },
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;
    ctx.registerConfigSchema("wopr-plugin-twitch", configSchema);

    const config = ctx.getConfig<TwitchConfig>() ?? {};

    if (!config.clientId || !config.accessToken) {
      ctx.log.warn("Twitch plugin not configured. Run 'wopr configure --plugin wopr-plugin-twitch'");
      return;
    }

    // Parse channels — config UI may send as comma-separated string
    const channels = Array.isArray(config.channels)
      ? config.channels
      : ((config.channels as string)
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? []);

    if (channels.length === 0) {
      ctx.log.warn("No Twitch channels configured");
      return;
    }

    const authProvider = new RefreshingAuthProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? "",
    });

    await authProvider.addUserForToken(
      {
        accessToken: config.accessToken,
        refreshToken: config.refreshToken ?? null,
        expiresIn: null,
        obtainmentTimestamp: Date.now(),
        scope: [
          "chat:read",
          "chat:edit",
          "whispers:read",
          "whispers:edit",
          "channel:read:redemptions",
          "channel:manage:redemptions",
        ],
      },
      ["chat"],
    );

    authProvider.onRefresh(async (_userId, newToken) => {
      ctx.log.info("Twitch OAuth token refreshed");
      await ctx.saveConfig({
        ...config,
        accessToken: newToken.accessToken,
        refreshToken: newToken.refreshToken,
      });
    });

    ctx.registerChannelProvider(twitchChannelProvider);
    ctx.log.info("Registered Twitch channel provider");

    chatManager = new TwitchChatManager(ctx, { ...config, channels });
    setChatManager(chatManager);

    try {
      await chatManager.connect(authProvider);
    } catch (err) {
      ctx.log.error(`Failed to connect to Twitch chat: ${err}`);
      return;
    }

    if (config.enableChannelPoints && config.broadcasterId) {
      eventSubManager = new TwitchEventSubManager(ctx, config.broadcasterId);
      try {
        await eventSubManager.start(authProvider);
      } catch (err) {
        ctx.log.error(`Failed to start EventSub: ${err}`);
        // Non-fatal — chat still works without channel points
      }
    }

    ctx.log.info("Twitch plugin initialized");
  },

  async shutdown() {
    if (eventSubManager) {
      await eventSubManager.stop();
      eventSubManager = null;
    }

    if (chatManager) {
      await chatManager.disconnect();
      setChatManager(null);
      chatManager = null;
    }

    if (pluginCtx) {
      pluginCtx.unregisterChannelProvider("twitch");
    }

    pluginCtx = null;
  },
};

export default plugin;
