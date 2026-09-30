// The maps. Each is a closed expressway loop (network.js builds it the same way for every map: dual
// carriageway, median, a parking area to the side reachable from and leaving to both directions) plus
// the world around it (world.js: land and water, bridges, city, trees, landmarks, sky).
//
//   ring       loop points [x, z, deck height]; heights under 4.2 make a tunnel
//   pa         where the parking area sits: { at: [x, z], ahead } (the loop point nearest `at`, then
//              `ahead` metres along), or { span: [[x, z], [x, z]] } (a long flat stretch: the PA goes
//              into it from whichever end the loop's direction reaches first)
//   gaps       median U-turn gaps, near these points
//   zones      named districts along the loop
//   world      scenery settings (see world.js)
//   rooms      online room prefix (players on different maps never share a room)
export const MAPS = {
  // ------------------------------------------------------------------ K1 loop, a fictional Tokyo
  k1: {
    id: 'k1', label: 'K1', rooms: 'k1',
    ring: [
      [-1600, 950, 12], [-1150, 1130, 13], [-650, 1200, 18], [-200, 1275, 29], [300, 1305, 33],
      [800, 1275, 29], [1200, 1150, 18], [1550, 950, 13], [1800, 650, 13], [1740, 390, 14], [1890, 130, 14],
      [1830, -300, 14], [1660, -700, 16], [1350, -985, 12], [900, -1150, 7], [400, -1235, 2.2],
      [-150, -1255, 2.2], [-650, -1205, 2.6], [-1100, -1080, 9], [-1500, -850, 12], [-1800, -500, 12],
      [-1925, -50, 12], [-1885, 450, 12],
    ],
    pa: { at: [-1925, 0], ahead: 150 },
    gaps: [[1350, -985], [-1150, 1130]],
    zones: [
      [-1600, 950, 'Minato Bayside'], [-450, 1240, 'Kaigan Bridge'], [1400, 1060, 'Shiodome Curve'],
      [1850, 300, 'Higashi Downtown'], [1500, -850, 'Kita Junction'], [700, -1190, 'Kita Tunnel'],
      [-1300, -980, 'Nishi Industrial'], [-1900, 200, 'Nishi Straight'],
    ],
    paName: 'Nishi PA',
    world: { kind: 'k1' },
  },

  // ------------------------------------------------------------------ Miami: mainland, bay, beach
  // Clockwise from the parking area on the mainland highway (west): north up the I-95 stretch, east over
  // the bay on the Julia Tuttle causeway (a cable bridge), south along the beach island with the ocean
  // right there (Collins / Ocean Drive), west back over the bay on the MacArthur causeway (the big
  // bridge, downtown skyline ahead), through the downtown viaducts and back onto the highway.
  miami: {
    id: 'miami', label: 'I-95', rooms: 'mi',
    ring: [
      // mainland highway (the PA's long flat stretch)
      [-1150, 1150, 12], [-1170, 600, 12], [-1180, 100, 12], [-1170, -400, 12], [-1145, -900, 12],
      // up and around the north end, onto the causeway
      [-1030, -1200, 14], [-700, -1340, 15],
      // Julia Tuttle causeway over Biscayne Bay (x -350 .. 850)
      [-300, -1380, 14], [100, -1400, 27], [500, -1380, 14],
      // onto the beach island, south along the ocean
      [900, -1250, 9], [1120, -950, 6.5], [1190, -500, 5.5], [1200, 0, 5.5], [1195, 450, 5.5], [1150, 850, 7],
      // MacArthur causeway back west over the bay
      [900, 1200, 13], [500, 1330, 16], [100, 1360, 31], [-300, 1330, 16],
      // downtown viaducts, back to the highway
      [-620, 1250, 20], [-960, 1320, 15],
    ],
    pa: { span: [[-1150, 1100], [-1150, -880]] },
    gaps: [[1190, -500], [-620, 1250]],
    zones: [
      [-1170, 300, 'I-95 North'], [-850, -1270, 'Julia Tuttle Causeway'], [650, -1330, 'Biscayne Bay'],
      [1180, -700, 'Miami Beach'], [1200, 150, 'Ocean Drive'], [1100, 900, 'South Beach'],
      [300, 1350, 'MacArthur Causeway'], [-650, 1240, 'Downtown Miami'],
    ],
    paName: 'Miami PA',
    world: {
      kind: 'miami',
      // land: the mainland (west of the bay) and the beach island; the beach sand on the island's ocean
      // side; everything else is water (the bay between them, the Atlantic to the east)
      land: [[-6000, -6000, -330, 6000], [860, -2600, 1255, 2600]],
      beach: [1255, -2600, 1400, 2600],
      bayX: [-330, 860],
    },
  },
};

// the map the game is built with (saved in the settings; the K1 loop by default)
export const mapOf = id => MAPS[id] || MAPS.k1;
