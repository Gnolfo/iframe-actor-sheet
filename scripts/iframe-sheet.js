const MODULE_ID = "iframe-actor-sheet";
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/sheet.hbs`;

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
  // Explicit render(true) still passes through (sheet open, manual refresh).
  async _render(force, options) {
    if (this.rendered && !force) return this;
    return super._render(force, options);
  }
}
