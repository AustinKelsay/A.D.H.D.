import { bootstrapDesktopClient } from "./desktop-app";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root element.");
}

void bootstrapDesktopClient(root);
