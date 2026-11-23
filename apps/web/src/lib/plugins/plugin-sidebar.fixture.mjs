export default {
  activate(context) {
    return context.ui.panels.register({
      id: "calendar",
      title: "Calendar",
      purpose: "dashboard",
      presentation: "sidebar",
      mount() {},
    });
  },
};
