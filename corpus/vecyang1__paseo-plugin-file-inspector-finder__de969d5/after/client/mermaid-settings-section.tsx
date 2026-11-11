/**
 * Settings -> Plugins -> File Inspector & Finder -> Mermaid diagram rendering.
 * Read: which hooks are live and what each diagram in this session got. Test: paste a diagram,
 * see the verdict the chat would use, and render it with Paseo's own `MermaidFence`. Tune: three
 * switches and Restore defaults. Behaviour lives in `client/markdown-mermaid-web.ts`.
 */
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { createElement, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MermaidSourceVerdict } from "../shared/mermaid-policy";
import {
  DEFAULT_MERMAID_PREFS,
  MERMAID_STATUS_EVENT,
  type MermaidEventKind,
  type MermaidPrefs,
  type MermaidStatus,
  currentMermaidVerdict,
  describeMermaidBlock,
  getHostMermaidFence,
  getMermaidStatus,
  syncMermaidPrefs,
} from "./markdown-mermaid-web";

type Styles = Record<"diagBox" | "row" | "input" | "btn" | "btnText" | "secondaryBtn" | "secondaryBtnText" | "label" | "detail", object>;

const SAMPLE = [
  "flowchart TD",
  '  A["Request"] --> B{"Local or cloud?"}',
  '  B -->|"small edit"| C["Local DOM edit<br><b>0 quota</b>"]',
  '  B -->|"new layout"| D["Cloud variants<br><b>1-3 quota</b>"]',
].join("\n");

const KIND_LABEL: Record<"en" | "zh", Record<MermaidEventKind, string>> = {
  en: {
    native: "rendered",
    widened: "rendered with tags",
    detected: "unlabelled fence",
    rejected: "blocked",
    "render-error": "parse error",
  },
  zh: {
    native: "原生渲染",
    widened: "含标签渲染",
    detected: "未标注代码块",
    rejected: "已拦截",
    "render-error": "解析失败",
  },
};

function verdictLine(verdict: MermaidSourceVerdict, zh: boolean): string {
  if (verdict.verdict === "native") return zh ? "Paseo 原生即可渲染。" : "Paseo renders this as is.";
  if (verdict.verdict === "widened") {
    const tags = verdict.widenedTags.map((tag) => `<${tag}>`).join(" ");
    return zh ? `可渲染；用到 ${tags}，Paseo 原生会拦截。` : `Renders; uses ${tags}, which Paseo alone blocks.`;
  }
  return describeMermaidBlock(verdict.reason ?? "html-tag", verdict.match, zh ? "zh" : "en");
}

export function MermaidSettingsSection({ isZh, styles }: { isZh: boolean; styles: Styles }) {
  const toast = useToast();
  const [status, setStatus] = useState<MermaidStatus>(() => getMermaidStatus());
  const [sample, setSample] = useState(SAMPLE);
  const [checked, setChecked] = useState<{ code: string; verdict: MermaidSourceVerdict } | null>(null);
  const HostFence = useMemo(() => getHostMermaidFence(), []);
  const lang = isZh ? "zh" : "en";

  useEffect(() => {
    const onStatus = () => setStatus(getMermaidStatus());
    window.addEventListener(MERMAID_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(MERMAID_STATUS_EVENT, onStatus);
  }, []);

  const setPref = (next: Partial<MermaidPrefs>) => {
    syncMermaidPrefs(next);
    setStatus(getMermaidStatus());
  };
  const hook = (ok: boolean, id: number | null) => (ok ? `✓ ${id ?? ""}`.trim() : "✕");
  const counts = status.counts;

  return (
    <SettingsSection title={isZh ? "Mermaid 图表渲染" : "Mermaid diagram rendering"}>
      <SettingsCard>
        <SettingsSwitch
          label={isZh ? "渲染含格式标签的图表" : "Render diagrams that use formatting tags"}
          hint={
            isZh
              ? "允许标签里使用 <b>、<strong>、<em> 等无属性标签；Paseo 其余安全检查保持开启。"
              : "Allows <b>, <strong>, <em> and other attribute-free tags in labels. Paseo's other safety checks stay on."
          }
          value={status.prefs.widenFormattingTags}
          onValueChange={(next: boolean) => setPref({ widenFormattingTags: next })}
        />
        <SettingsSwitch
          label={isZh ? "识别未标注语言的图表代码块" : "Detect unlabelled diagram fences"}
          hint={
            isZh
              ? "以 flowchart TD、sequenceDiagram 等 Mermaid 头部开头的无语言代码块，以及 mmd 代码块，也渲染为图表。"
              : "Renders fences with no language that start with a Mermaid header (flowchart TD, sequenceDiagram), and mmd fences."
          }
          value={status.prefs.detectUntaggedFences}
          onValueChange={(next: boolean) => setPref({ detectUntaggedFences: next })}
        />
        <SettingsSwitch
          label={isZh ? "说明以源码显示的原因" : "Explain diagrams shown as source"}
          hint={
            isZh
              ? "图表退回源码时，在下方用一行写明原因。"
              : "Adds one line under a diagram that stays as source, naming what blocked it."
          }
          value={status.prefs.explainBlocked}
          onValueChange={(next: boolean) => setPref({ explainBlocked: next })}
        />
      </SettingsCard>

      <View style={styles.diagBox} testID="mermaid-settings-status">
        <Text style={styles.detail}>
          {isZh ? "钩子" : "Hooks"}: policy {hook(status.policyHook.installed, status.policyHook.moduleId)} ·
          renderer {hook(status.renderersHook.installed, status.renderersHook.moduleId)} · preview{" "}
          {status.hostFenceAvailable ? "✓" : "✕"}
        </Text>
        <Text style={styles.detail}>
          {isZh ? "本次会话" : "This session"}:{" "}
          {(Object.keys(KIND_LABEL.en) as MermaidEventKind[])
            .map((kind) => `${KIND_LABEL[lang][kind]} ${counts[kind]}`)
            .join(" · ")}
        </Text>
        {status.recent.slice(0, 4).map((event, index) => (
          <Text key={`${event.at}_${index}`} style={styles.detail} numberOfLines={1}>
            • {KIND_LABEL[lang][event.kind]}
            {event.detail ? ` (${event.detail})` : ""} · {event.preview}
          </Text>
        ))}

        <TextInput
          value={sample}
          onChangeText={setSample}
          multiline
          numberOfLines={5}
          style={[styles.input, { minHeight: 96, fontFamily: "monospace" }]}
          testID="mermaid-settings-input"
        />
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            testID="mermaid-settings-check"
            onPress={() => {
              const verdict = currentMermaidVerdict(sample);
              setChecked({ code: sample, verdict });
              toast.show(verdictLine(verdict, isZh));
            }}
            style={styles.btn}
          >
            <Text style={styles.btnText}>{isZh ? "检查并预览" : "Check and preview"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPref(DEFAULT_MERMAID_PREFS);
              toast.show(isZh ? "已恢复默认" : "Defaults restored");
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{isZh ? "恢复默认" : "Restore defaults"}</Text>
          </Pressable>
        </View>
        {checked ? (
          <View style={{ gap: 6 }} testID="mermaid-settings-result">
            <Text style={styles.label}>{verdictLine(checked.verdict, isZh)}</Text>
            {HostFence ? createElement(HostFence, { key: checked.code, code: checked.code }) : null}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}
