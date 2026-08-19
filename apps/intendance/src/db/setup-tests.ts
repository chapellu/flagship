// IndexedDB n'existe pas dans Node : on en installe une vraie implémentation en
// mémoire. Les tests exercent donc Dexie pour de bon — transactions, index,
// clés — au lieu d'un bouchon qui dirait toujours oui.
import "fake-indexeddb/auto";
