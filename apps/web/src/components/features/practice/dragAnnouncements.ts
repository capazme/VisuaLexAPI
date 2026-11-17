type Id = string | number;

/**
 * What a screen reader hears while an act is dragged (LC61): the acts' names, never their ids, and nothing that reads
 * «X sopra X». On pick-up «Hai preso X»; over another act «X sopra Y»; back over its own place, after a move, «X di
 * nuovo al suo posto»; dropped where it was, «X lasciato dov'era». One per drag list; `heading` names an act by its id.
 */
export function dragAnnouncements(heading: (id: Id) => string) {
  let moved = false;
  return {
    onDragStart: ({ active }: { active: { id: Id } }) => {
      moved = false;
      return `Hai preso ${heading(active.id)}.`;
    },
    onDragOver: ({ active, over }: { active: { id: Id }; over: { id: Id } | null }) => {
      if (!over) return `${heading(active.id)} fuori dall'elenco degli atti.`;
      if (over.id === active.id) return moved ? `${heading(active.id)} di nuovo al suo posto.` : undefined;
      moved = true;
      return `${heading(active.id)} sopra ${heading(over.id)}.`;
    },
    onDragEnd: ({ active, over }: { active: { id: Id }; over: { id: Id } | null }) =>
      over && over.id !== active.id ? `${heading(active.id)} spostato al posto di ${heading(over.id)}.` : `${heading(active.id)} lasciato dov'era.`,
    onDragCancel: ({ active }: { active: { id: Id } }) => `Spostamento di ${heading(active.id)} annullato.`,
  };
}

/** The handle's role, said in Italian (dnd-kit's default is «sortable»). */
export const DRAG_ROLE_DESCRIPTION = 'riordinabile';
