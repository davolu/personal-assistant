import { toolkitLogo } from "@/lib/toolkits";

export default function ToolkitChip({
  name,
  size = "sm",
}: {
  name: string;
  size?: "sm" | "lg";
}) {
  const logo = toolkitLogo(name, size === "lg" ? 64 : 32);
  const cls =
    size === "lg"
      ? "inline-flex items-center gap-2 rounded-lg bg-panel px-3 py-1.5 font-mono text-xs text-ink ring-1 ring-line"
      : "inline-flex items-center gap-1.5 rounded-md bg-ground px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-line";
  const imgCls = size === "lg" ? "size-4 rounded-[3px]" : "size-3.5 rounded-[2px]";
  return (
    <span className={cls}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className={imgCls} loading="lazy" />
      ) : (
        <span className={`${imgCls} grid place-items-center bg-line text-[8px] font-bold text-muted`}>
          {name.charAt(0)}
        </span>
      )}
      {name}
    </span>
  );
}
