"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CommitInput } from "./CommitInput";
import { FIELD_TYPE_LABELS } from "./FieldSettings";
import { uniqueId } from "@/lib/schema/ids";
import type { ApplyResult, SchemaOp } from "@/lib/schema/ops";
import type { Field, FormSchema, Step } from "@/lib/schema/types";

type Props = {
  schema: FormSchema;
  selectedFieldId: string | null;
  onSelect: (fieldId: string) => void;
  onApply: (op: SchemaOp, label: string) => ApplyResult;
};

// Each step has an invisible drop zone at its end, so you can drop a field
// AFTER the last field of another step.
const END_PREFIX = "end:";

/**
 * Left column: steps and their fields. Drag to reorder (mouse, touch or
 * keyboard: focus a handle, Space to pick up, arrows to move, Space to drop).
 * Every drop is ONE moveField op, so it's validated, undoable and autosaved.
 */
export function Outline({ schema, selectedFieldId, onSelect, onApply }: Props) {
  const sensors = useSensors(
    // A 4px move is needed before a drag starts, so plain clicks still work.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const labelOf = (id: UniqueIdentifier) => {
    const field = schema.steps.flatMap((s) => s.fields).find((f) => f.id === id);
    return field?.label ?? (String(id).startsWith(END_PREFIX) ? "the end of the step" : String(id));
  };

  // What screen readers hear while dragging (defaults would read raw ids).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
    // Right after pick-up, dnd-kit reports the item as "over" itself. Saying
    // "Mobile number is over Mobile number" would replace "Picked up…", so stay quiet.
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id ? `${labelOf(active.id)} is over ${labelOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) => (over ? `Dropped ${labelOf(active.id)} at ${labelOf(over.id)}.` : `Dropped ${labelOf(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${labelOf(active.id)} was not moved.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const overId = String(over.id);

    let toStep: Step | undefined;
    let index: number;
    if (overId.startsWith(END_PREFIX)) {
      toStep = schema.steps.find((s) => s.id === overId.slice(END_PREFIX.length));
      if (!toStep) return;
      const sameStep = toStep.fields.some((f) => f.id === active.id);
      index = toStep.fields.length - (sameStep ? 1 : 0);
    } else {
      toStep = schema.steps.find((s) => s.fields.some((f) => f.id === overId));
      if (!toStep) return;
      index = toStep.fields.findIndex((f) => f.id === overId);
    }
    onApply({ op: "moveField", fieldId: String(active.id), toStepId: toStep.id, index }, `Move ${labelOf(active.id)}`);
  }

  function addField(step: Step) {
    const id = uniqueId(schema, "new_field");
    const result = onApply(
      { op: "addField", stepId: step.id, index: step.fields.length, field: { id, type: "text", label: "New field", required: false } },
      "Add field",
    );
    if (result.ok) onSelect(id);
  }

  function addStep() {
    const stepId = uniqueId(schema, "new_step");
    const fieldId = uniqueId(schema, "new_field");
    const step: Step = { id: stepId, title: "New step", fields: [{ id: fieldId, type: "text", label: "New field", required: false }] };
    const result = onApply({ op: "addStep", index: schema.steps.length, step }, "Add step");
    if (result.ok) onSelect(fieldId);
  }

  return (
    <DndContext id="outline-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
      <nav aria-label="Form outline" className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Steps &amp; fields</h2>
        {schema.steps.map((step, i) => (
          <section key={step.id} aria-label={`Step ${i + 1}: ${step.title}`} className="space-y-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{i + 1}.</span>
              <CommitInput
                id={`step-title-${step.id}`}
                aria-label={`Step ${i + 1} title`}
                value={step.title}
                onCommit={(title) => onApply({ op: "updateStep", stepId: step.id, changes: { title } }, "Rename step")}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-zinc-800 hover:border-zinc-300 focus:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-zinc-200 dark:hover:border-zinc-700"
              />
              <button
                type="button"
                aria-label={`Delete step ${step.title}`}
                onClick={() => onApply({ op: "removeStep", stepId: step.id }, `Delete step ${step.title}`)}
                className="rounded px-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
              >
                ✕
              </button>
            </div>

            <SortableContext items={step.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {step.fields.map((field) => (
                  <FieldRow key={field.id} field={field} selected={field.id === selectedFieldId} onSelect={onSelect} onApply={onApply} />
                ))}
                <EndDropZone stepId={step.id} />
              </ul>
            </SortableContext>

            <button type="button" onClick={() => addField(step)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              + Add field
            </button>
          </section>
        ))}
        <button
          type="button"
          onClick={addStep}
          className="w-full rounded-md border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          + Add step
        </button>
      </nav>
    </DndContext>
  );
}

function FieldRow({
  field,
  selected,
  onSelect,
  onApply,
}: {
  field: Field;
  selected: boolean;
  onSelect: (id: string) => void;
  onApply: Props["onApply"];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-md border px-1 py-1 text-sm ${
        selected
          ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      } ${isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}`}
    >
      {/* Only the handle starts a drag, so the rest of the row stays clickable. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Drag to reorder ${field.label}`}
        className="cursor-grab touch-none rounded px-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={() => onSelect(field.id)}
        aria-pressed={selected}
        className="min-w-0 flex-1 truncate text-left text-zinc-800 dark:text-zinc-200"
      >
        {field.label}
        {field.showIf && <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">(conditional)</span>}
      </button>
      <span className="shrink-0 rounded bg-zinc-100 px-1 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {FIELD_TYPE_LABELS[field.type]}
      </span>
      <button
        type="button"
        aria-label={`Delete ${field.label}`}
        onClick={() => onApply({ op: "removeField", fieldId: field.id }, `Delete ${field.label}`)}
        className="shrink-0 rounded px-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
      >
        ✕
      </button>
    </li>
  );
}

function EndDropZone({ stepId }: { stepId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${END_PREFIX}${stepId}` });
  return <li ref={setNodeRef} aria-hidden="true" className={`h-2 rounded ${isOver ? "bg-indigo-200 dark:bg-indigo-800" : ""}`} />;
}
