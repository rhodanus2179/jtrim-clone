export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(id, definition) {
    this.commands.set(id, definition);
    return this;
  }

  canExecute(id) {
    const command = this.commands.get(id);
    if (!command) return false;
    return command.enabled ? Boolean(command.enabled()) : true;
  }

  async execute(id, ...args) {
    const command = this.commands.get(id);
    if (!command || !this.canExecute(id)) return;
    return await command.run(...args);
  }

  bind(root = document) {
    root.addEventListener("click", event => {
      const element = event.target.closest("[data-command]");
      if (!element) return;
      event.preventDefault();
      this.execute(element.dataset.command);
    });
  }

  refresh(root = document) {
    root.querySelectorAll("[data-command]").forEach(element => {
      element.disabled = !this.canExecute(element.dataset.command);
    });
  }
}
