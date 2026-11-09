// Toutes les constantes de règles du jeu. Le client reçoit une copie (event "config")
// pour que les textes affichés soient toujours alignés sur les vraies règles.
module.exports = Object.freeze({
  TOTAL_PERIODS: 6,
  ACTIONS_PER_PERIOD: 2,
  PERIOD_SECONDS: 600,
  TUTORIAL_SECONDS: 300,
  MILITARY_UNLOCK_PERIOD: 5,

  RESOURCES: ['oil', 'food', 'tourism', 'agriculture'],
  BASE_PRICES: { oil: 80, food: 40, tourism: 120, agriculture: 60 },
  SELL_RATIO: 0.8,           // on revend à 80 % du prix du marché
  MEAN_REVERT: 1 / 3,        // les prix reviennent d'1/3 vers la base à chaque période
  INCOME_PER_UNIT: { oil: 25, tourism: 25, agriculture: 20 },
  BASE_INCOME: 100,
  MAX_QTY: 100000,

  FOOD_MIN: 10, FOOD_MAX: 50, // consommation par période (dépend de la population)
  FAMINE_LOSS_PER_UNIT: 25,   // points de puissance perdus par unité de nourriture manquante
  INACTIVITY_PENALTY: 100,

  SOLDIER_COST: 150,
  ATK_COST: 200,
  DEF_COST: 200,
  ATK_PER_POINT: 0.01,        // +1 % de force d'attaque par point
  DEF_PER_POINT: 0.01,        // +1 % de force de défense par point

  TIER_B_BONUS: 1.15,
  TERRITORY_POWER: 400,       // points de puissance par territoire annexé

  // Guerre
  COMBAT_VARIANCE: 0.35,      // aléa ±35 %
  ATTACK_COSTS: { gold: 150, oil: 200, food: 300 },
  NO_RESOURCE_SACRIFICE: 0.10,
  FIRST_ASSAULT_LOOT: 0.5,
  FORTIFY_BONUS: 0.25,
  COMMIT_OPTIONS: [0.25, 0.5, 0.75, 1],
  WAR_TURN_SECONDS: 45,
  WAR_MAX_ROUNDS: 6,
  WAR_START_DELAY: 15,        // secondes (cinématique de l'écran)
  ATTACK_RESOLVE_DELAY: 5,    // secondes d'animation avant le tour suivant

  // Diplomatie
  OFFENSIVE_ALLIANCE_COST: 100,
  OFFENSIVE_ALLIANCE_BONUS: 0.15,
  PROPOSAL_SECONDS: 30,

  // Événements à choix
  CHOICE_SECONDS: 60,

  // Transitions (cinématique écran)
  TRANSITION_SECONDS: 18,
  VIDEO_TRANSITION_SECONDS: 45,
});
