import { type ReactNode } from "react";
import { type Project } from "../store";
import { type ProjectTab } from "../app/types";
import { Button } from "@heroui/react";
import { Empty, Icon as NxIcon, Segmented } from "../ui";
import { Card } from "../app/common";
import { selectClass } from "../app/styles";

/** One page for everything about a project: pick it, edit it, then switch
 *  between its status and its bindings. Replaces the separate Projects,
 *  Overview and Bindings tabs. */
export function ProjectPage({ project, projects, tab, onTab, onSelect, onAdd, onEdit, onRemove, children }: {
  project: Project | undefined;
  projects: Project[];
  tab: ProjectTab;
  onTab: (tab: ProjectTab) => void;
  onSelect: (projectId: string) => void;
  onAdd: () => void;
  onEdit: (project: Project) => void;
  onRemove: (project: Project) => void;
  children: ReactNode;
}) {
  if (!project) {
    return <Card><Empty title="No projects yet" action={<Button size="sm" onPress={onAdd}>Add your first project</Button>}>Register a folder so Nexus knows which project an agent is in.</Empty></Card>;
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12px] text-(--muted)">
          <NxIcon name="folder" size={15} />
          <span className="sr-only">Project</span>
          <select aria-label="Project" value={project.id} onChange={(e) => onSelect(e.target.value)} className={`${selectClass} !w-auto min-w-[160px]`}>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <Segmented label="Project section" value={tab} onChange={onTab} options={[{ value: "status", label: "Status" }, { value: "bindings", label: "Bindings" }]} />
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onPress={() => onEdit(project)}>Edit</Button>
          <Button size="sm" variant="danger-soft" onPress={() => onRemove(project)}>Remove</Button>
          <Button size="sm" variant="outline" onPress={onAdd}><NxIcon name="plus" size={15} />Add project</Button>
        </span>
      </div>
      {children}
    </div>
  );
}
