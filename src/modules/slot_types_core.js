/**
 * Slot Types Core Registry
 * - Categories and their groups
 * - Keywords per category (broad)
 * Keep this file "structural": category/group names + broad keywords.
 * Put huge alias lists in slot_types_synonyms.js
 */

export const SLOT_TYPES_CORE = {
  // 0) Equipment classifications (for items grid classification, not paper-doll slots)
  EQUIPMENT_CLASS: {
    keywords: [
      "weapon","armor","blade","sword","dagger","knife","mace","hammer","polearm","spear","bow","crossbow",
      "wand","staff","orb","rod","grimoire","shield","buckler","plate","leather","chain","robe","cloak"
    ],
    groups: {
      "Blade (Short)": [],
      "Blade (Long)": [],
      "Blunt": [],
      "Polearm": [],
      "Ranged (Mech)": [],
      "Magic Focus": [],
      "Shields": [],
      "Armor (Light)": [],
      "Armor (Medium)": [],
      "Armor (Heavy)": [],
    }
  },

  // 1) Alchemy
  ALCHEMY: {
    keywords: [
      "alchemy","potion","elixir","poison","reagent","solvent","catalyst","extract","essence","tincture",
      "distillate","mutagen","serum","virus","dna","ichor","venom","slime","acid","gas","vial","flask"
    ],
    groups: {
      "Base": [],
      "Solid Reagents": [],
      "Mineral Reagents": [],
      "Animal Parts": [],
      "Refined States": [],
      "Containers/Catalysts": [],
      "Mutagens": [],
      "Combustibles": [],
      "Celestial": [],
      "Preservatives": [],
      "Poisons (Contact)": [],
      "Poisons (Ingested)": [],
      "Solvents (Acid)": [],
      "Gases": [],
      "Biological Fluids": [],
      "Philosophical": [],
    }
  },

  // 2) Enchantment
  ENCHANTMENT: {
    keywords: [
      "enchant","enchantment","rune","sigil","glyph","ward","seal","socket","runeword","gem","jewel",
      "arcane dust","holy dust","shadow dust","void","astral","phylactery","soul gem","totem","talisman",
      "hex","curse","ritual","summon","aura","metaphysical","fate","karma"
    ],
    groups: {
      "Runes": [],
      "Gems (Socketables)": [],
      "Magical Dusts": [],
      "Components": [],
      "Catalysts": [],
      "Binding Agents": [],
      "Voodoo/Hex": [],
      "Ritual": [],
      "Spirit": [],
      "Fortune": [],
      "Warding": [],
      "Curses": [],
      "Summoning": [],
      "Auras": [],
      "Sockets (Runewords)": [],
      "Metaphysical": [],
    }
  },

  // 3) Crafting
  CRAFTING: {
    keywords: [
      "craft","crafting","smith","blacksmith","carpentry","tailor","engineering",
      "ore","ingot","plate","sheet","rod","wire","scrap","slag",
      "log","plank","beam","veneer","plywood",
      "cotton","wool","silk","linen","hemp","fur","leather","hide",
      "nail","screw","bolt","nut","rivet","hinge","buckle","clasp",
      "flux","dye","varnish","glue","resin","grease",
      "gear","spring","chain","ceramic","porcelain","brick","tile","pipe"
    ],
    groups: {
      "Metals": [],
      "Woods": [],
      "Textiles": [],
      "Intermediate Parts": [],
      "Refining Agents": [],
      "Specialty": [],
      "Synthetics": [],
      "Electronics": [],
      "Mechanisms": [],
      "Adhesives": [],
      "Tools (Consumable)": [],
      "Liquids (Industrial)": [],
      "Glass/Optics": [],
      "Paper/Packaging": [],
      "Precious Materials": [],
      "Scrap (Tech)": [],
    }
  },

  // 4) Cooking
  COOKING: {
    keywords: [
      "cook","cooking","ingredient","meal","provision","spice","herb","broth","sauce","vinegar","honey",
      "meat","fish","poultry","fruit","vegetable","dairy","egg","grain","flour","bread","pastry",
      "ferment","yeast","culture","drink","coffee","tea","cocoa","juice","smoothie",
      "beer","ale","wine","whiskey","vodka","rum","gin","sake","mead",
      "dessert","cake","pie","cookie","ice cream","jam","pickle","kimchi"
    ],
    groups: {
      "Meats": [],
      "Vegetables": [],
      "Fruits": [],
      "Dairy/Eggs": [],
      "Grains/Baking": [],
      "Seasoning/Misc": [],
      "Fermentation": [],
      "Drinks (Hot)": [],
      "Drinks (Cold)": [],
      "Alcohol": [],
      "Dishes (Main)": [],
      "Dishes (Side)": [],
      "Desserts": [],
      "Exotic Meat": [],
      "Preserves": [],
      "Condiments": [],
    }
  },

  // 5) Misc
  MISC: {
    keywords: [
      "currency","coin","token","chip","credit","scrip","valuable","antique","heirloom","bullion","bond","deed",
      "junk","trash","debris","rag","broken","sludge",
      "gift","perfume","toy","doll","ribbon","comb","mirror",
      "soap","bandage","salve","torch","flint","tinder","tobacco","pipe",
      "sack","crate","barrel","box","chest","pouch","envelope","packet","jar","tin",
      "game","dice","cards","hygiene","office","mail"
    ],
    groups: {
      "Currency": [],
      "Valuables": [],
      "Junk": [],
      "Gifts": [],
      "Consumables (Non-Food)": [],
      "Containers": [],
      "Games": [],
      "Toys": [],
      "Musical": [],
      "Hygiene": [],
      "Clothing (Cosmetic)": [],
      "Smoking": [],
      "Trash (Organic)": [],
      "Trash (Inorganic)": [],
      "Office": [],
      "Mail": [],
    }
  },

  // 6) Quest / Key Items
  QUEST: {
    keywords: [
      "quest","key item","key","keycard","passcode","signet","activation",
      "letter","note","diary","journal","contract","treaty","bounty","manifesto","map",
      "evidence","clue","photo","recording","blueprint","schematic","cipher","dossier","transcript",
      "trophy","badge","medal","insignia","rank","title","certificate","award",
      "artifact","relic","macguffin","parcel","shipment","cargo","beacon","signal",
      "identification","passport","permit","form","voucher","ticket","contraband"
    ],
    groups: {
      "Keys": [],
      "Documents": [],
      "Intel": [],
      "Magical Keys": [],
      "Trophies": [],
      "Unique": [],
      "Identification": [],
      "Crime": [],
      "Body Parts (Monster)": [],
      "Bureaucracy": [],
      "Tickets": [],
      "Keys (Specific)": [],
      "Lost Items": [],
      "Messages": [],
      "Tokens": [],
      "Packages": [],
    }
  },

  // 7) Farming
  FARMING: {
    keywords: [
      "seed","sapling","fertilizer","compost","mulch","lime","bonemeal","sprinkler","watering can","hose",
      "scarecrow","fence","gate","trellis","planter","greenhouse","trowel","rake","pitchfork",
      "hydroponic","ph tester","ec meter","beekeeping","hive","propolis","orchard"
    ],
    groups: {
      "Seeds (Seasonal)": [],
      "Saplings/Trees": [],
      "Enhancers": [],
      "Irrigation/Tools": [],
      "Infrastructure": [],
      "Harvest Tools": [],
      "Mushrooms": [],
      "Hydroponics": [],
      "Beekeeping": [],
      "Automation": [],
      "Exotic Crops": [],
      "Orchard": [],
      "Flowers": [],
      "Fencing": [],
      "Greenhouse": [],
      "Compost": [],
    }
  },

  // 8) Husbandry
  HUSBANDRY: {
    keywords: [
      "hay","fodder","feed","treat","groom","brush","hoof","shear","clipper","shampoo",
      "saddle","bridle","reins","stirrups","halter","tack","harness","collar","leash",
      "incubator","milker","trough","stable","barn","coop","silo",
      "vet","syringe","ointment","cast","splint","genetic","dna","fertilized egg",
      "mount","taming","trap","tranquilizer"
    ],
    groups: {
      "Fodder": [],
      "Treats/Bonding": [],
      "Grooming": [],
      "Tack (Mounts)": [],
      "Equipment": [],
      "Housing/Care": [],
      "Fantasy Pets": [],
      "Genetics": [],
      "Veterinary": [],
      "Toys": [],
      "Housing (Specific)": [],
      "Grooming (Advanced)": [],
      "Feed (Premium)": [],
      "Mount Gear": [],
      "Products": [],
      "Wild Taming": [],
    }
  },

  // 9) Fishing
  FISHING: {
    keywords: [
      "rod","bait","lure","tackle","hook","sinker","bobber","line","trap","crab pot",
      "harpoon","net","license","angler","legendary fish","ice fishing","lava fishing","void fishing",
      "boat","anchor","oar","paddle","sail","sonar","radar"
    ],
    groups: {
      "Rods": [],
      "Baits (Consumable)": [],
      "Lures (Durable)": [],
      "Tackle": [],
      "Traps": [],
      "Utility": [],
      "Lava Fishing": [],
      "Void Fishing": [],
      "Ice Fishing": [],
      "Boat Gear": [],
      "Legendary Fish": [],
      "Shellfish": [],
      "Crustaceans": [],
      "Deep Sea": [],
      "Trophies": [],
      "Processing": [],
    }
  },

  // 10) Housing & Decor
  HOUSING: {
    keywords: [
      "chair","sofa","table","desk","counter","altar","workbench","bed","hammock","sleeping bag",
      "wardrobe","dresser","cabinet","shelf","bookcase","safe",
      "lamp","chandelier","sconce","candle","lantern","fireplace","brazier",
      "rug","tapestry","painting","poster","statue","vase","mirror","clock",
      "toilet","sink","bathtub","shower","kitchen","fridge","stove","oven","microwave"
    ],
    groups: {
      "Seating": [],
      "Surfaces": [],
      "Sleeping": [],
      "Storage": [],
      "Lighting": [],
      "Decor": [],
      "Electronics (Entertainment)": [],
      "Electronics (Office)": [],
      "Bathroom": [],
      "Kitchen (Appliances)": [],
      "Flooring (Types)": [],
      "Walls (Paper)": [],
      "Windows": [],
      "Fireplace": [],
      "Outdoor Decor": [],
      "Structural": [],
    }
  },

  // 11) Knowledge & Skill
  KNOWLEDGE: {
    keywords: [
      "recipe","cookbook","blueprint","pattern","schematic","manual","treatise","guide","textbook","scroll",
      "map","atlas","chart","bestiary","chronicle","myth","legend","law",
      "usb","sd card","hard drive","ssd","floppy","cd","dvd","tape",
      "data crystal","memory shard","echo stone","thought gem","cipher","codebook","rosetta"
    ],
    groups: {
      "Recipes (Culinary)": [],
      "Schematics (Crafting)": [],
      "Skill Books": [],
      "Maps": [],
      "Bestiary": [],
      "History/Culture": [],
      "Digital Media": [],
      "Crystal Storage": [],
      "Arcane Records": [],
      "Maps (Specific)": [],
      "Books (Genres)": [],
      "Notes": [],
      "Languages": [],
      "Research": [],
      "Teaching": [],
      "Secrets": [],
    }
  },

  // 13) Entomology
  ENTOMOLOGY: {
    keywords: [
      "butterfly","moth","beetle","cicada","mantis","dragonfly","bee","wasp","hornet","roach","ant","termite",
      "spider","scorpion","tick","mite","slug","snail","worm","leech",
      "net","specimen","jar","pin","mount","magnifying","field guide","pheromone"
    ],
    groups: {
      "Butterflies/Moths": [],
      "Beetles": [],
      "Crawlers": [],
      "Hoppers/Flyers": [],
      "Aquatic/Swamp": [],
      "Collection Tools": [],
      "Arachnids": [],
      "Hive Products": [],
      "Worms/Slugs": [],
      "Exotic Bugs": [],
      "Pests": [],
      "Catching (Baits)": [],
      "Display": [],
      "Breeding": [],
      "Tools": [],
      "Lore": [],
    }
  },

  // 14) Archaeology & Geology
  ARCHAEOLOGY: {
    keywords: [
      "geode","fossil","artifact","relic","excavate","dig","museum","node","crystal cluster",
      "pickaxe","brush","chisel","sieve","shovel","pan","drill","headlamp",
      "restoration","survey","metal detector","lidar","radar"
    ],
    groups: {
      "Geodes/Nodes": [],
      "Fossils (Parts)": [],
      "Fossils (Complete)": [],
      "Artifacts (Household)": [],
      "Artifacts (Ritual)": [],
      "Tools": [],
      "Cleaning Tools": [],
      "Survey": [],
      "Excavation": [],
      "Storage": [],
      "Artifacts (Stone)": [],
      "Artifacts (Metal)": [],
      "Artifacts (Organic)": [],
      "Artifacts (Ceramic)": [],
      "Restoration": [],
      "Era": [],
    }
  },

  // 15) Survival & Exploration
  SURVIVAL: {
    keywords: [
      "tent","bedroll","tarp","hammock","blanket","torch","tinder","firestarter","flint","steel",
      "canteen","waterskin","filter","purifier","ration","mre","jerky","trail mix",
      "rope","grappling","piton","carabiner","harness","crampons","ice axe",
      "compass","sextant","spyglass","binoculars","beacon","flare","whistle",
      "first aid","bandage","tourniquet","antidote","splint","stitch kit"
    ],
    groups: {
      "Shelter": [],
      "Fire/Heat": [],
      "Hydration/Food": [],
      "Climbing/Traversal": [],
      "Navigation": [],
      "Field Medicine": [],
      "Hunting": [],
      "Signaling": [],
      "Weather": [],
      "Navigation (Celestial)": [],
      "Water": [],
      "Fire": [],
      "Shelter (Natural)": [],
      "First Aid": [],
      "Tools": [],
      "Food (Wild)": [],
    }
  },

  // 16) Construction & Architecture
  CONSTRUCTION: {
    keywords: [
      "wall","floor","roof","door","gate","window","stair","ladder","pillar","beam","arch","support",
      "fence","turret","spikes","moat","bridge","signpost","mailbox","flagpole",
      "generator","battery","transformer","fuse","switch","outlet","sensor","relay","logic gate",
      "bulldozer","excavator","crane","forklift","dumptruck","mixer",
      "pipe","valve","coupling","pump","concrete","drywall","insulation","asphalt"
    ],
    groups: {
      "Walls": [],
      "Floors": [],
      "Roofing": [],
      "Access": [],
      "Vertical": [],
      "Utility/Defense": [],
      "Power": [],
      "Logic": [],
      "Heavy Machinery": [],
      "Pipes": [],
      "Materials (Raw)": [],
      "Materials (Refined)": [],
      "Fasteners": [],
      "Finishing": [],
      "Safety": [],
      "Demolition": [],
    }
  },

  // 17) Merchant & Trade Goods
  MERCHANT: {
    keywords: [
      "crate","barrel","sack","bundle","pallet","invoice","ledger","bill of lading","permit","license",
      "luxury","caviar","saffron","vanilla","tea","coffee","wine","vintage",
      "bullion","gold","platinum","stock","bond","share","loan","debt","insurance",
      "black market","contraband","smuggled","forgery","service","repair","upgrade","identify"
    ],
    groups: {
      "Bulk Crates": [],
      "Textile Goods": [],
      "Luxury Food": [],
      "Art/Jewelry": [],
      "Industry": [],
      "Documents": [],
      "Black Market": [],
      "Services": [],
      "Financial": [],
      "Real Estate": [],
      "Trade Goods (Raw)": [],
      "Trade Goods (Processed)": [],
      "Currencies": [],
      "Packaging": [],
      "Shop Gear": [],
      "Reputation": [],
    }
  },

  UNCATEGORIZED: { keywords: [], groups: {} },
};
