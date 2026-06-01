// Single source of truth for the feature-card grids shown on the home, blogs,
// and games landing pages. Previously these were hand-maintained arrays of
// `*_md.html` fragment paths fetched and transformed in the browser; now the
// cards.njk macro renders them at build time from this data.
const cards = {
  trivia: {
    title: "The Daily Board",
    href: "/games/trivia/",
    blurb: [
      "Challenge yourself in this daily trivia game",
      "Each day, test your recall on diverse topics such as history, pop culture, sports, geography and more",
      "Maximize your score before you get 3 questions wrong",
    ],
  },
  holdem: {
    title: "Texas Tile Tussle",
    href: "/games/holdem/",
    blurb: [
      "Poker meets scrabble in a game to spell the strongest word in your hand",
      "Wager through 3 rounds in a Texas Hold'em style",
      "If you are dealt a Q you better hope for a U on the river",
    ],
  },
  bingo: {
    title: "Bingo Board Generator",
    href: "/games/bingo/",
    blurb: [
      "Create a custom bingo board with your own entries",
      "Generate a shareable link so every player gets their own randomized board",
      "Mark off squares as they are called and track your progress",
    ],
  },
  voice: {
    title: "Voice Room",
    href: "/games/voice/",
    blurb: [
      "Drop into a live voice room with up to 6 people, right in your browser",
      "Everyone is mixed together on the server, with a volume slider for each person",
      "Voice-activity gated mic and server-side mixing — proximity chat coming next",
    ],
  },
  doggone: {
    title: "Doggone",
    href: "https://dangertimmy.itch.io/doggone",
    blurb: [
      "Environment driven visual novel about a mysterious world and a lost dog",
      "Winner of best sound design in the 2020 UT Game Jam",
      "Scrappy project completed in 48hrs with no previous gamdev / godot experience",
    ],
  },
  recall: {
    title: "Recall in the Age of AI",
    href: "/blogs/recall",
    blurb: [
      "AI makes information effortless to find, but what's the cost of outsourcing your memory?",
      "Techniques I've used to turn the generative word machine into a tool for retention",
    ],
  },
  race_results: {
    title: "Half Marathon Race Results",
    href: "/blogs/race_results",
    blurb: [
      "Visualizing my finish at the 2026 PNC Alexandria Half Marathon",
      "Reflections on goal setting and habit",
    ],
  },
  running: {
    title: "Half Marathon Training",
    href: "/blogs/running",
    blurb: [
      "Tracking my training regime for the 2026 Alexandria half marathon",
      "Come see if I'm sticking to my plan or not",
    ],
  },
  twinkle: {
    title: "The Perfect Christmas Lights, Overengineered",
    href: "/blogs/twinkle",
    blurb: [
      "Modern LED christmas lights don't have the same cozy magic as the old ones",
      "Simulating the electromagnetic properties of the old ones to capture that cozy magic",
    ],
  },
  ddns: {
    title: "Dynamic DNS for Home Hosting",
    href: "/blogs/ddns",
    blurb: [
      "Overcoming the constraints of standard home internet to avoid cloud fees",
      "The simple solution for self hosting this site while preserving privacy",
    ],
  },
  webgpu: {
    title: "Google Webgpu Experiments",
    href: "/blogs/webgpu",
    blurb: [
      "Navigating the interesting world of shaders for the first time ever",
      "Play around with an interactive Conway's Game of Life running entirely on your GPU",
    ],
  },
  bitflip: {
    title: "Cosmic Ray Memory Corruption",
    href: "/blogs/bitflip",
    blurb: [
      "Computer memory can and has been effected by cosmic rays and alpha particles, but do they effect the average computer?",
      "Investigated RAM errors on a statically allocated chunk of memory over time",
    ],
  },
  gallery: {
    prefix: "WIP: ",
    title: "Artwork Gallery with 3D effects",
    href: "/gallery",
    blurb: ["Digitally preserve texture and lighting in artwork"],
  },
  photos: {
    title: "Photo Gallery",
    href: "/photos",
    blurb: [
      "Enjoy some of my photography from around the world in a simple gallery view",
    ],
  },
};

module.exports = {
  home: [
    cards.trivia,
    cards.recall,
    cards.holdem,
    cards.race_results,
    cards.running,
    cards.twinkle,
    cards.ddns,
    cards.webgpu,
    cards.photos,
  ],
  blogs: [
    cards.recall,
    cards.race_results,
    cards.running,
    cards.twinkle,
    cards.ddns,
    cards.bitflip,
    cards.webgpu,
    cards.gallery,
  ],
  games: [cards.holdem, cards.trivia, cards.bingo, cards.voice, cards.doggone],
};
