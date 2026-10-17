import { CodeSource } from "../types";

export interface EditorChangeInput {
  text: string;
  rangeLength: number;
  languageId: string;
  isActiveEditor: boolean;
}

export interface EditorChangeClassification {
  source: CodeSource;
  detectionMethod: "editor-assisted-change" | "manual-deletion";
  reason: string;
}

export class ChangeAttributionClassifier {
  classifyEditorChange(
    change: EditorChangeInput,
  ): EditorChangeClassification | null {
    if (!change.isActiveEditor) {
      return null;
    }

    if (change.text.length === 0 && change.rangeLength > 0) {
      return {
        source: CodeSource.Neutral,
        detectionMethod: "manual-deletion",
        reason: "Deletion made in the active editor",
      };
    }

    if (this.looksEditorAssisted(change.text, change.languageId)) {
      return {
        source: CodeSource.Neutral,
        detectionMethod: "editor-assisted-change",
        reason: "Markup inserted by an editor-assisted feature",
      };
    }

    return null;
  }

  private looksEditorAssisted(text: string, languageId: string): boolean {
    if (!/^(html|handlebars|razor|vue|svelte|xml)$/.test(languageId)) {
      return false;
    }

    return /<\/[-\w]+\s*>/.test(text) ||
      (/<[-\w]+[^>]*>/.test(text) && /<\/[-\w]+\s*>/.test(text));
  }
}