// Real GTA 6 frames as the eye masks them (mayorlyWord on the 320x180 frame), gzipped and in
// base64: one bit a pixel of the middle of the frame, never a picture. Frames marked "old cut" were
// masked at the first white cut (min channel 200, tint 60), which took in more than the word: they
// stay as harder cases. At today's cut (230, 30) the low-health shirt is no white at all. From two YouTube videos
// played in Chrome: "WASTED COMPILATION | GTA 6" (P72MUjkVS-c, 67 deaths in 27 minutes, every one
// of them read, nothing else) and "GTA 6 busted and wasted and mission failed" (FdfJrFHv0YY).
// `word` is what the frame shows; 'none' is play.

export const WORD_FRAMES: { what: string; word: 'wasted' | 'failed' | 'busted' | 'none'; mask: string }[] = [
  {
    what: 'compilation 0:57, white on the red wash',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3RsQ2DMBCFYadyyQiM4sEi4TKlVwoTeAQcubgycoURBy8yFTYgRYqUFOG/7qtOd0Kc/VfN97xRxqNFG4WOas6ckIbBOncLQp8cH7hW1hJRD2aeV/soZe+S3CWKwnV35DcQHgNjz8PGr53Z9REGfuv1CENOhoFZvOUDKiJKzqU/qQ8TT9kd6oAq7VPe58irALl4zP+yuIdD1HHtZ2c/7gV3zJXhwAYAAA==',
  },
  {
    what: 'compilation 1:00, red on black',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3QMQ4CIRCFYYzFlnsEj8LNltKSK5lYWO4RZEMxpRILIE72GYpNBKHVQv7ya+ZlhOj9V9P3fJLa4owlCBXkmjmB4MFglfttc+Q+11zJuelE3oOZ17c9Us6nge67IApX15ZfQFgio/QjCK7iuupPaNhPPyQ3dSezd5FZZB6hiR7JufAx3S3/0HRX99Fh2FyVbmEQVOa93o97AfNaKozABgAA',
  },
  {
    what: 'compilation 1:31, with scenery read as a row too',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3RMQ7CMAyF4SCGjj0CR8nBkJqRMVcCcYAcoUUZPHtqqlp9KJmapJ2QYKC/t2+ybKWO/qvue95p6/HEIygT9JI5IY5ATO4OhDE6PnCjnSOiESKyrPbR2t0bGk5BFW76Pb+B8JoEW86VX3u76TMsfO2XGZaGhicRVfu59gktkY8upYNGTndYO0cHl/fZ85bRJA/5X5J7DAj5H4+Oftwb2KQycMAGAAA=',
  },
  {
    what: 'compilation 2:39, with scenery read as a row too',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3RMQ7CIBTGcYwDY4/Qo3AwkzI6ciWNB+AIxTC8mak0feln6CRQB2Oig/zf9lsg7wnR+q+G7/mgjMcN1yh0VGvmhDQM1rlbEKbk+MC1spaIJjDz+vQfpexFkjtEUbgeX/kZhPvM2PNQ+Wk0u77AwNfeLzDkZJiZRe3H2md0RJScS0/vlnvow3veBcjNY36XzT0cYn7HVuvHPQC0zHvgwAYAAA==',
  },
  {
    what: 'compilation 17:00, the lowest-scoring read of a death, red on black',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3RMQ7CMAyF4SCGjj0CR/HNyMiYKyExMOYIbdXBI3RKolp5KEOlJm1WGOg/fopky1Hq6L+6fs8jmREPDF5pT3H1hAyD4SAQnftrceRu91yTrTqzcxCRuNqHyN4bfp+8Klx3NX+CMQRB6Tcwpo0DZtdnGIwV77d+mWG4P09BRGUeYJhdcim8TXPLO1R9qnqz+Ppf2uQjenid+dHRj/sAFPLDh8AGAAA=',
  },
  {
    what: 'clip 0:13, red on black',
    word: 'wasted',
    mask: 'H4sIAAAAAAAACu3RvQ2DMBCGYaeiZARGYbPcCF4JKUVKRgBEcWXiyrY4+YtAFDY/SZcU8Vs+suzTWancf3X9nodaM24YnCJXh+jI7AwLgVDqj9UDEm/bI6c3zmwtREKI5iHqmoKfF6dSr6lrysWx9TsYg5edazDMzoFjn6Axnni/uMReTdDcF8aLqJ2znT25p/Io53e3ezh189GTfykNCozo4SjxXO7HvQA1VoGMwAYAAA==',
  },
  {
    what: 'clip 0:04, BUSTED on the blue wash (white at the old cut of 200, more ink than the eye sends now)',
    word: 'busted',
    mask: 'H4sIAAAAAAAACu3RzQmAMAyG4YADOEJGyWh1k67iSHpLIPhJT1JbD+IfSN9TeQ4lJESt39fp9ubxRcdsHlSoR4/MzRwOMGLV5aKbmXvyGGPhJHTG4SKC55wPnJIPXM6ZfDcnDOn/yn5u8gkalBfO79hqfdwK+0IWHMAGAAA=',
  },
  {
    what: 'clip 0:20, FAILED on the red wash (white at the old cut of 200, more ink than the eye sends now)',
    word: 'failed',
    mask: 'H4sIAAAAAAAACu3RPQqAMAyA0YJDxhyhx+3oEbxKt465QraO7Q0iVRcbFX9AUPqNjxBCa0zrCyG/6Z0EcZFBnKwchCRERiHtMbJ97BmJgS1RquY9lvnzHpb9tdM1z7jnqbhH5XTk6s5pvwwb73DHe+0we/WPrdY/GgFAVU1NwAYAAA==',
  },
  {
    what: 'clip 0:23, FAILED in red on black',
    word: 'failed',
    mask: 'H4sIAAAAAAAACu3RsQ2AIBCFYRMLyhuBkRzJ0jFchY7yjSAdJWxw5qQSLiY0Jhr+8gt5ITBNoy9E4U2f2TNiIN745oYhbhmtp06PmmdCMMECqTrvSHYUX8t+7Z51R59nevS8NA5xR7o39792eFfeQfzodLRuilf/OBr9oxORvgSxwAYAAA==',
  },
  {
    what: 'compilation 8:12, low health: a red edge and a white shirt in the middle (white at the old cut of 200, more ink than the eye sends now)',
    word: 'none',
    mask: 'H4sIAAAAAAAACu3TsQ3CMBSEYVtGgs5skFEyEx2dGY1RMkJKJBAHsVIg8p8lIgoKXvk5kvXu4hAWsy/jEkMISWf0eD2hhwPzf35mjsZlGpUG4ij+NaKkGx0U6U7eS3j15BfwzlyQv+TbhtMCzpOeizmHhatDpNWhgurwaqtDcKscgph9hw5BzL559yk3Csh5Mh7Fga5zKKC0HIppOhTWmwKaDkGvcijYefehZ1NYNgVkk0/14eX7B9lUuaPABgAA',
  },
  {
    what: 'compilation 22:49, low health over a fight (white at the old cut of 200, more ink than the eye sends now)',
    word: 'none',
    mask: 'H4sIAAAAAAAACu2TvY7TQBSFz8QhDtIujlgKigQHeIFFCFgJCbukRjR0Lumg3CLSjGigg0fgHWgoKGY3SJTsI0TbUNAYKks7+MDMeJw4PwUFHVPk2l+u79+5A/w///SMtmOh/ypKtMP90aan+y26TK2T9ox3lFdu58crz70V965Xp+c2sUK+8vEgPPW7iRch8AjDzWQ58H5bXfl6CQAOvf/qK8KA8g1vHDVJhOpgO7tDPC1W6wz9KbzYVgyAiTfTdf5401UqIDpb5guWCtjv1oIBkBDADHHnn0QhM8BB2eopQjAaYKJbFUJ3MUvgxjJC4CkXwPUlD/EkdaehvcbSloODdj0zb256PsDaiVhb83EHX7Sg0T5xfDRc908dv7IEt5r0lgtuCCwdX/ix9L3avnwCMR4u5+Cb/MPtQGR7Dfa0u4OknVtPfu6Fjl/auyJImikuUxWzhs8gDCKSFXC7FiYMbGzL8zx6WzqV3WZJiF/KcqUHiY4vymbWEpCV5VojRczT2GfOFNI68nWOkdSvPRbUSPiFpFM0re9VzYBzJJyT9VXgBLLKPI8vtOf08/ghPRdSY99yI3L79TeW7nZc+l56/59fz67lkClVql1eg9Ryfef0/jT6lBlM3Eo9o844p+njVa+I3rGEUxoPSPKEaijy/nPMeR6ZRlm6XRsC/QJ5au5WgdPvIN48QaqPP5RW5N8GAAREwAYAAA==',
  },
  {
    what: 'compilation 0:10, a night ride with the HUD',
    word: 'none',
    mask: 'H4sIAAAAAAAACmNgGAWDHfQ6MDDhkGIswC7O7IBFsISDgaEBi3gNDsNrGLCZglu9BQ7xYQtAgclGG6MVcMqwkGhSHWnK7aljzCgYBfQAAOcwtwfABgAA',
  },
  {
    what: 'clip 0:09, bright scenery at the top of the middle (white at the old cut of 200, more ink than the eye sends now)',
    word: 'none',
    mask: 'H4sIAAAAAAAACu2RPU7DQBCF38YIGiubgoIi8uYGOcLmKogDkBusO8pQ0nEU3FFxB0tQUliIYoXCPPBGkcYm4kdyqPIVa+/nN56xF9jiyMqs27sSGktGE7MG5ouX82gjsq43pFyQL31/FCiWfILt+jzw7ZJNxaAfZDgLlCBlTjpdYOXz/Y8RIF2l/Lz1zzUQ2Gkwl3vKNQDfyc+mS6HUbSdxovJF5PtrG8w41WMWxe1DU6Xv89QN8rtVs0gJz1pX8KoBMMLYc639KZbpOvJk91dsfDoJrbdzuH7+ZhOzK6KHaZexrfs+cXxS7vTDMNutzTclE735abbF30cagskvMgOzz1P6rw4HDuyTD/5SN9PABgAA',
  },
]
