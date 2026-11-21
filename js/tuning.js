// Réglages du choix des questions, réunis ici pour pouvoir les ajuster et les tester facilement.

export const TUNING = {
  // Détection des tics (js/tics.js)
  minUses: 3,                 // utilisations minimales d'une expression, d'un emoji…
  minWordUses: 5,             // … et d'un mot seul
  maxTics: 12,                // tics retenus par personne
  cohesion: 0.3,              // une expression doit « tenir ensemble » (voir cohesive)
  smoothing: 30,              // K : un petit bavard est ramené vers la moyenne
  // Du plus exigeant au plus souple : écart minimal (lift), avance sur le deuxième (z),
  // part minimale des utilisations d'un mot (exclusive).
  levels: [
    { lift: 2.5, z: 2.5, exclusive: 0.95 },
    { lift: 2, z: 2, exclusive: 0.85 },
    { lift: 1.6, z: 1.5, exclusive: 0.75 },
    { lift: 1.4, z: 1, exclusive: 0.6 },
  ],
  wordLift: 1.5,              // écart minimal d'un mot ou d'une expression (en plus de l'exclusivité)
  // Classement des tics d'une même personne
  boostExpr: 1.35, boostEdge: 0.6, boostPunct: 0.7, boostMedia: 1.3, boostEmoji: 1,
  perKind: { mot: 2, emoji: 2, ponct: 1, debut: 2, fin: 2, sticker: 2, gif: 2 },
  // « Qui a écrit ça ? » : messages retenus par personne, poids des réactions
  maxQuotes: 3, quoteReaction: 5, quoteBuzz: 0.3, quoteMin: 20, quoteMax: 150, quoteEmojiWeight: 1,

  // Score commun des questions (js/scoring.js) : fun × netteté^a × intensité^b × fiabilité^c.
  scoreExp: [0.4, 0.3, 0.3],
  sharpSat: 2,                // netteté : ×4 d'écart avec le deuxième donne 1
  intensitySat: 3,            // intensité : ×8 face à la médiane donne 1
  reliableN: 8,               // fiabilité : 1 − e^(−n/8) (3 occurrences : 0,31 ; 20 : 0,92)
  quoteTypical: 6,            // « qui a écrit ça ? » : typicité qui le rend tout à fait reconnaissable
  // Photos : une bonne question d'office (les réactions par appui long ne sont pas dans l'export) ;
  // les commentaires juste après et le fait d'être envoyée seule (pas dans une rafale) sont des bonus.
  photoFloor: 0.6, photoAlone: 0.1,
  // Fun a priori de chaque sorte de question (grille à la main, resserrée autour de 0,64).
  fun: {
    culte: 0.80, photo: 0.80, sticker: 0.76, gif: 0.76, expr: 0.69, message: 0.65, emoji: 0.61, mot: 0.57,
    debut: 0.50, fin: 0.50, ponct: 0.42, favori: 0.65,
    habitude: { vocal: 0.69, sticker: 0.65, gif: 0.65, photo: 0.57, video: 0.57, media: 0.42 },
    record: {
      explosif: 0.80, anniv: 0.80, fantome: 0.76, nuit: 0.76, supprime: 0.76, pave: 0.72, bavard: 0.69, rapide: 0.65,
      rafale: 0.65, matinal: 0.65, telegraphe: 0.65, rieur: 0.61, dernier: 0.61, retouche: 0.61, relance: 0.57,
      curieux: 0.57, liens: 0.57, exclamation: 0.54,
    },
  },

  // Composition de la partie (js/game.js). Chaque catégorie a un plancher et un plafond de manches ;
  // les manches restantes vont aux meilleures questions, toutes catégories confondues.
  // titre : titres, habitudes (« qui envoie le plus de vocaux ? ») et emoji préféré.
  bounds: {
    10: { message: [2, 4], titre: [2, 3], photo: [2, 3], tic: [2, 3] },
    15: { message: [3, 6], titre: [2, 5], photo: [3, 4], tic: [3, 5] },
    20: { message: [4, 8], titre: [3, 6], photo: [4, 5], tic: [4, 6] },
  },
  cults: { 10: 1, 15: 2, 20: 2 },  // messages cultes au plus
  messagesPerPerson: 2,
  minScore: 0.15,             // en dessous, une question n'est posée que s'il ne reste rien d'autre
  personShare: 0.25,          // une personne est la réponse d'au plus 25 % des manches (plus s'il y a trop peu de monde)
  edgeMax: 0,                 // débuts et fins de message, en tout (presque toujours de faux tics)
  presentBoost: 2,            // les joueurs présents passent devant les absents
  ownerPenalty: 1,            // plus quelqu'un a déjà de manches, moins il en reçoit : valeur / (1 + n)^ownerPenalty
  jitter: 0.1,                // un peu de hasard (±30 %) pour que deux parties ne se ressemblent pas
};
