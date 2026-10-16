import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: (_: string, label: string) => {
    if (label === "typescript" || label === "javascript") {
      return new Worker(
        new URL("../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
        { type: "module" }
      );
    }
    return new Worker(
      new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
      { type: "module" }
    );
  },
};

loader.config({ monaco });
