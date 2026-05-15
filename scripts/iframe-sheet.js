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
  console.log(`${MODULE_ID} | registered`);
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
    // `html` is a jQuery wrapper in v1, a plain HTMLElement under v13's v1-shim.
    // `this.element` similarly varies. Normalize to a root Element.
    const root =
      (html instanceof Element ? html : html?.[0]) ??
      (this.element instanceof Element ? this.element : this.element?.[0]);
    const iframe = root?.tagName === "IFRAME" ? root : root?.querySelector?.("iframe");
    if (!iframe) {
      console.warn(`${MODULE_ID} | activateListeners: iframe element not found`, {
        rootTag: root?.tagName,
        rootHTML: root?.outerHTML?.slice(0, 300),
      });
      return;
    }

    let iframeOrigin;
    try { iframeOrigin = new URL(iframe.src).origin; }
    catch { console.warn(`${MODULE_ID} | activateListeners: invalid iframe.src`, iframe.src); return; }

    console.log(`${MODULE_ID} | listening for messages from`, iframeOrigin);

    const sendContext = (target) => {
      const win = target ?? iframe.contentWindow;
      if (!win) return;
      const payload = {
        type: `${MSG_PREFIX}context`,
        actorId: this.actor.id,
        actorName: this.actor.name,
        userId: game.user.id,
        worldId: game.world.id,
        systemId: game.system.id,
        isOwner: this.actor.isOwner,
        isGM: game.user.isGM,
      };
      try {
        win.postMessage(payload, iframeOrigin);
        console.log(`${MODULE_ID} | sent context to`, iframeOrigin);
      } catch (err) {
        console.warn(`${MODULE_ID} | failed to post context`, err);
      }
    };
    iframe.addEventListener("load", () => sendContext());

    this._onMessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (typeof msg.type !== "string" || !msg.type.startsWith(MSG_PREFIX)) return;

      console.log(`${MODULE_ID} | message received`, {
        type: msg.type,
        origin: event.origin,
        expected: iframeOrigin,
        sourceMatchesIframe: event.source === iframe.contentWindow,
      });

      if (event.origin !== iframeOrigin) {
        console.warn(`${MODULE_ID} | origin mismatch — dropping`, event.origin, "expected", iframeOrigin);
        return;
      }
      this._dispatch(msg, event.source);
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

  _dispatch(msg, source) {
    switch (msg.type) {
      case `${MSG_PREFIX}hello`:
        return this._sendContextTo(source);
      case `${MSG_PREFIX}roll`:
        return this._handleRoll(msg);
      default:
        console.debug(`${MODULE_ID} | unhandled message type`, msg.type);
    }
  }

  _sendContextTo(source) {
    if (!source) return;
    const root = this.element instanceof Element ? this.element : this.element?.[0];
    const iframe = root?.tagName === "IFRAME" ? root : root?.querySelector?.("iframe");
    if (!iframe) return;
    const iframeOrigin = new URL(iframe.src).origin;
    source.postMessage({
      type: `${MSG_PREFIX}context`,
      actorId: this.actor.id,
      actorName: this.actor.name,
      userId: game.user.id,
      worldId: game.world.id,
      systemId: game.system.id,
      isOwner: this.actor.isOwner,
      isGM: game.user.isGM,
    }, iframeOrigin);
    console.log(`${MODULE_ID} | replied to hello with context`);
  }

  async _handleRoll({ formula, flavor }) {
    console.log(`${MODULE_ID} | handling roll`, { formula, flavor });
    if (typeof formula !== "string" || !formula.trim()) {
      console.warn(`${MODULE_ID} | roll: bad formula`, formula);
      return;
    }
    if (!this.actor.isOwner && !game.user.isGM) {
      console.warn(`${MODULE_ID} | roll: user lacks owner permission on actor`);
      return;
    }
    try {
      const rollData = this.actor.getRollData?.() ?? {};
      const roll = await new Roll(formula, rollData).evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: typeof flavor === "string" ? flavor : undefined,
      });
      console.log(`${MODULE_ID} | roll posted: total =`, roll.total);
    } catch (err) {
      console.error(`${MODULE_ID} | roll failed`, err);
      ui.notifications?.warn(`Iframe sheet: invalid roll formula "${formula}"`);
    }
  }
}
