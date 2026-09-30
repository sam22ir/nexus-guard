import { type Project } from "../store";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon } from "../ui";
import { PageTitle, Card } from "../app/common";

export function ProjectsView({ projects, selectedProject, onSelect, onAdd, onEdit, onRemove }: { projects: Project[]; selectedProject: string; onSelect: (name: string) => void; onAdd: () => void; onEdit: (project: Project) => void; onRemove: (project: Project) => void }) {
  return (
    <div className="app-view flex w-full flex-col gap-4">
      <PageTitle
        description="One card per project: its folder, environment, and the resources it is bound to."
        action={<Button size="sm" onPress={onAdd}><NxIcon name="plus" size={15} />Add project</Button>}
      />
      {projects.length === 0 ? (
        <Card><Empty title="No projects yet" action={<Button size="sm" onPress={onAdd}>Add your first project</Button>}>Register a folder so Nexus knows which project an agent is in.</Empty></Card>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {projects.map((item) => {
            const selected = item.id === selectedProject;
            const shown = item.connections.slice(0, 4);
            return (
              <article key={item.id} className="nx-card flex flex-col gap-3" style={selected ? { borderColor: "var(--text)" } : undefined}>
                <button type="button" onClick={() => onSelect(item.id)} aria-label={`Select ${item.name}`} className="flex items-start gap-3 rounded-[10px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
                  <span className="nx-tile"><NxIcon name="folder" size={17} /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="truncate text-[15px] font-semibold text-(--text)">{item.name}</strong>
                    <span className="nx-mono truncate text-(--muted)">{item.path}</span>
                  </span>
                  <Badge tone={selected ? "success" : "neutral"} dot={selected}>{selected ? "Selected" : "Saved"}</Badge>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.environment.toLowerCase().startsWith("prod") ? "warning" : "neutral"}>{item.environment}</Badge>
                  {shown.map((connection) => <span key={connection.id} className="nx-badge">{connection.provider} · {connection.resource ?? connection.target}</span>)}
                  {item.connections.length > shown.length && <span className="nx-badge">+{item.connections.length - shown.length}</span>}
                  {item.connections.length === 0 && <span className="text-[12px] text-(--muted)">No resources yet</span>}
                </div>
                <p className="truncate text-[12px] text-(--muted-2)">Branch {item.branch} · {item.repo}</p>
                <div className="mt-auto flex items-center justify-between border-t border-(--line-soft) pt-3">
                  <span className="text-[12px] tabular-nums text-(--muted)">{item.connections.length} connection{item.connections.length === 1 ? "" : "s"}</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onPress={() => onEdit(item)}>Edit</Button>
                    <Button size="sm" variant="danger-soft" onPress={() => onRemove(item)}>Remove</Button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
