import { register } from "node:module";
import { pathToFileURL } from "node:url";

const loaderCode = `
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") {
    const stub =
      'export const Platform = { OS: "web" }; export const Text = "Text"; export const View = "View"; export const Pressable = "Pressable";';
    return {
      shortCircuit: true,
      url: "data:text/javascript;base64," + Buffer.from(stub).toString("base64"),
    };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
      const candidate = path.resolve(parentPath, specifier + ext);
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString("base64")}`, pathToFileURL("./"));
