// Shared by the server layout and the client theme store.
export const THEME_KEY = "trip-planner.theme";

/** Runs in <head> before paint, so a saved Dark or Light choice never flashes the other theme. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
