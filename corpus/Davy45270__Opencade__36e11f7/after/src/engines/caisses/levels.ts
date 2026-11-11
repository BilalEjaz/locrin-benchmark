/** Thirty workshops (pass 403): fifteen historical rooms frozen by the exact A*,
 * and rooms with mechanisms found by an offline search and proved by the exact
 * breadth-first search of solver.ts (HL-479: '%' cracked floor; a cracked room may hold
 * one spare crate per crack, to fill the hole). Records are exact; `budget` marks the five
 * challenges (moves allowed). Dimensions never exceed 9 × 8. */
export interface Workshop { name: string; minimumSteps: number; minimumPushes: number; budget?: number; text: string }
export const LEVELS: readonly Workshop[] = [
    { name: "Premier appui", minimumSteps: 2, minimumPushes: 1, text: "#######\n#@ $. #\n#     #\n#######" },
    { name: "Le pilier", minimumSteps: 5, minimumPushes: 2, text: "#######\n#     #\n#     #\n# .#  #\n#  $  #\n#   @ #\n#######" },
    // HL-479: was a 7 × 7 one-crate room next to "Le pilier" (the campaign's only near-clone pair).
    { name: "Une à la fois", minimumSteps: 9, minimumPushes: 4, text: "########\n#  .   #\n#@$$ . #\n#      #\n########" },
    { name: "La patinoire", minimumSteps: 2, minimumPushes: 1, text: "##########\n#@ $~~~~.#\n#        #\n##########" },
    { name: "Défi : sous le pilier", minimumSteps: 9, minimumPushes: 2, budget: 13, text: "#######\n#     #\n#     #\n#  #  #\n#  $ @#\n# .   #\n#######" },
    { name: "Glissade", minimumSteps: 18, minimumPushes: 5, text: "########\n#  .   #\n# #@~$ #\n# # ~ ~#\n# #$.~ #\n##     #\n########" },
    { name: "Deux passages", minimumSteps: 10, minimumPushes: 4, text: "#######\n#  @  #\n#.# $.#\n#     #\n# $ # #\n#     #\n#######" },
    { name: "Sens unique", minimumSteps: 18, minimumPushes: 4, text: "########\n#      #\n#   ># #\n# .  v #\n# ^$$  #\n#    .@#\n########" },
    { name: "Contresens", minimumSteps: 23, minimumPushes: 5, text: "########\n#   .###\n#v $.  #\n#<$  # #\n#>   #@#\n#      #\n########" },
    { name: "Défi : face à face", minimumSteps: 12, minimumPushes: 4, budget: 16, text: "#######\n#     #\n# #   #\n#.    #\n# $$# #\n#   + #\n#######" },
    { name: "La poche", minimumSteps: 14, minimumPushes: 4, text: "#######\n#     #\n# # $ #\n#     #\n#  .#$#\n#    +#\n#######" },
    { name: "Le bouton", minimumSteps: 27, minimumPushes: 9, text: "########\n#. @   #\n#      #\n###.   #\n# $ o$ #\n# |    #\n########" },
    { name: "Sas automatique", minimumSteps: 32, minimumPushes: 7, text: "########\n##.   ##\n# @$|  #\n#      #\n##o#$#|#\n# .    #\n########" },
    { name: "Glace et flèches", minimumSteps: 18, minimumPushes: 6, text: "########\n##  .#~#\n#<   #~#\n# $$#>##\n#~^@~. #\n#  ~~~>#\n########" },
    { name: "Défi : la serrure", minimumSteps: 34, minimumPushes: 11, budget: 45, text: "########\n#  #   #\n##  $. #\n#  # | #\n# $|.o@#\n##     #\n########" },
    { name: "Le gouffre", minimumSteps: 18, minimumPushes: 9, text: "########\n##@    #\n#    $ #\n##$$   #\n# O#  .#\n#    #.#\n########" },
    { name: "Pont de caisses", minimumSteps: 30, minimumPushes: 8, text: "########\n##     #\n## @.  #\n# $ $  #\n# $ ## #\n#O#.   #\n########" },
    // HL-479: the cracked floor. The only bridge gives way behind the player; the spare crate fills the hole, and
    // the third goes back over it to the left target.
    { name: "Le pont fragile", minimumSteps: 26, minimumPushes: 9, text: "##########\n#   #    #\n# . %  $ #\n#   # $  #\n#@  #  $.#\n#   #    #\n##########" },
    { name: "Les ailes", minimumSteps: 15, minimumPushes: 4, text: "#######\n#    .#\n# # $ #\n#     #\n# $ # #\n#  . @#\n#######" },
    { name: "Défi : double colonne", minimumSteps: 18, minimumPushes: 6, budget: 24, text: "########\n# .  $ #\n# .# $ #\n# $ . @#\n#   #  #\n#      #\n########" },
    { name: "Le passage secret", minimumSteps: 24, minimumPushes: 8, text: "########\n#1 .   #\n##$    #\n#  ##  #\n#  $ #@#\n# 2   .#\n########" },
    { name: "Raccourci", minimumSteps: 14, minimumPushes: 6, text: "########\n#@ 2  ##\n# .    #\n# . $$ #\n#   #  #\n#     1#\n########" },
    // HL-479: the cracked bridge again, now with pads. One crate crosses, the bridge gives way, the pads bring the
    // player back, the spare crate fills the hole and the last one crosses.
    { name: "Aller-retour", minimumSteps: 38, minimumPushes: 16, text: "##########\n#1   #  .#\n#  $ %   #\n# $ $#  .#\n#@   # 2 #\n##########" },
    { name: "Le crochet", minimumSteps: 14, minimumPushes: 4, text: "#######\n# $ . #\n# #   #\n#     #\n# $ # #\n#  .@ #\n#######" },
    { name: "Défi : porte et flèches", minimumSteps: 40, minimumPushes: 10, budget: 52, text: "########\n#   #  #\n### .  #\n#v#o $ #\n#. $|^ #\n# #   @#\n########" },
    { name: "Deux couleurs", minimumSteps: 28, minimumPushes: 10, text: "########\n####R  #\n#  .#$ #\n# # r  #\n# #    #\n#@     #\n########" },
    { name: "Tri par couleur", minimumSteps: 20, minimumPushes: 4, text: "########\n#   #  #\n##  .$ #\n#  #r  #\n#     R#\n#  #@# #\n########" },
    { name: "Le laboratoire", minimumSteps: 21, minimumPushes: 6, text: "########\n##1 ~#~#\n#|$~   #\n# 2$o .#\n#.~   @#\n#      #\n########" },
    { name: "Le carrefour", minimumSteps: 21, minimumPushes: 13, text: "########\n#.   $@#\n#    $$#\n# .##$ #\n#*  .* #\n#     .#\n#      #\n########" },
    { name: "Grand final", minimumSteps: 43, minimumPushes: 14, text: "#########\n##.~<<  #\n##~2#$~ #\n#~##1$o##\n#^v$OOr #\n#  #|$.R#\n##~@ ~ ~#\n#########" },
];
