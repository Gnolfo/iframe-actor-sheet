const MODULE_ID = "iframe-actor-sheet";
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/sheet.hbs`;
const MSG_PREFIX = "ias:";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "url", {
    name: "Sheet URL",
    hint: "URL loaded in the iframe. Placeholders: {actorId}, {actorName}, {userId}, {worldId}, {systemId}.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  Actors.registerSheet(game.system.id, IframeActorSheet, {
    label: "Iframe Sheet",
    makeDefault: false,
  });
});

class IframeActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["iframe-actor-sheet"],
      template: TEMPLATE_PATH,
      width: 900,
      height: 1000,
      resizable: true,
      submitOnChange: false,
      submitOnClose: false,
      closeOnSubmit: false,
    });
  }

  getData(options) {
    const data = super.getData(options);
    const template = game.settings.get(MODULE_ID, "url") || "";
    data.iframeUrl = template ? this._resolveUrl(template) : "";
    data.hasUrl = !!data.iframeUrl;
    return data;
  }

  _resolveUrl(template) {
    const subs = {
      actorId: this.actor?.id ?? "",
      actorName: this.actor?.name ?? "",
      userId: game.user?.id ?? "",
      worldId: game.world?.id ?? "",
      systemId: game.system?.id ?? "",
    };
    return template.replace(/\{(\w+)\}/g, (match, key) =>
      key in subs ? encodeURIComponent(subs[key]) : match,
    );
  }

  // Skip data-driven re-renders so the iframe doesn't reload on every actor update.
  async _render(force, options) {
    if (this.rendered && !force) return this;
    return super._render(force, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const iframe = html[0]?.querySelector("iframe.iframe-actor-sheet__frame");
    if (!iframe) return;

    let iframeOrigin;
    try { iframeOrigin = new URL(iframe.src).origin; } catch { return; }

    const sendContext = () => {
      try {
        iframe.contentWindow?.postMessage({
          type: `${MSG_PREFIX}context`,
          actorId: this.actor.id,
          actorName: this.actor.name,
          userId: game.user.id,
          worldId: game.world.id,
          systemId: game.system.id,
          isOwner: this.actor.isOwner,
          isGM: game.user.isGM,
        }, iframeOrigin);
      } catch (err) {
        console.warn(`${MODULE_ID} | failed to post context`, err);
      }
    };
    iframe.addEventListener("load", sendContext);

    this._onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== iframeOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (typeof msg.type !== "string" || !msg.type.startsWith(MSG_PREFIX)) return;
      this._dispatch(msg);
    };
    window.addEventListener("message", this._onMessage);
  }

  async close(options) {
    if (this._onMessage) {
      window.removeEventListener("message", this._onMessage);
      this._onMessage = null;
    }
    return super.close(options);
  }

  _dispatch(msg) {
    switch (msg.type) {
      case `${MSG_PREFIX}roll`:
        return this._handleRoll(msg);
      default:
        console.debug(`${MODULE_ID} | unhandled message type`, msg.type);
    }
  }

  async _handleRoll({ formula, flavor }) {
    if (typeof formula !== "string" || !formula.trim()) return;
    if (!this.actor.isOwner && !game.user.isGM) return;
    try {
      const rollData = this.actor.getRollData?.() ?? {};
      const roll = await new Roll(formula, rollData).evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: typeof flavor === "string" ? flavor : undefined,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | roll failed`, err);
      ui.notifications?.warn(`Iframe sheet: invalid roll formula "${formula}"`);
    }
  }
}
