# Testing checklist

Run through this on a real phone after installing a new build or changing `rules/rules.json`.
Use default settings unless a step says otherwise. If something that should be hidden shows up,
tap the **flag** in the toolbar on that screen (a leak report) and note the step number.

## Login and session

- [ ] 1. Open Lite Social → Instagram. Instagram's own login page loads (no Lite Social login screen).
- [ ] 2. Log in. If you use 2FA, the code screen works and accepts your code.
- [ ] 3. "Log in with Facebook" (if you use it) completes and returns to Instagram.
- [ ] 4. Force-close Lite Social, reopen it → Instagram. You're still logged in.
- [ ] 5. No "Open in app" / "Get the app" banner is shown, and nothing switches you to the real Instagram app.

## Feed

- [ ] 6. The feed opens as the **Following** feed (URL ends in `?variant=following`, posts are chronological).
- [ ] 7. Reels and videos in the feed are collapsed to a thin "Reel hidden by Lite Social" bar.
- [ ] 8. "Suggested for you" posts and the suggested-accounts carousel are hidden or collapsed.
- [ ] 9. After 30 posts the feed ends with the "That's 30 posts. You're all caught up" card.
- [ ] 10. Videos don't start playing on their own, and no sound plays from anything hidden.

## Reels blocking

- [ ] 11. The Reels tab is gone from the bottom navigation.
- [ ] 12. On any profile, the Reels tab is gone and reel tiles are hidden from the grid.
- [ ] 13. Open a direct link to a reel (e.g. send yourself one, or paste `https://www.instagram.com/reels/` into a
      DM to yourself and tap it). You see the "Blocked by Lite Social" screen; "Back to Instagram" returns you.
- [ ] 14. Tap home in Instagram's own navigation and anywhere a reel might be linked; no Reels viewer opens.

## Core features still work

- [ ] 15. **DMs:** open Messages, read a thread, send a text message. On Android the keyboard doesn't cover the
      message box.
- [ ] 16. **Profiles:** open your own and someone else's profile; posts open.
- [ ] 17. **Search:** tap search, find a specific user, open their profile. (With Hide Explore on, the
      recommendation grid under the search box is empty.)
- [ ] 18. **Notifications:** open the activity/heart screen.
- [ ] 19. **Posting:** tap +, pick a photo from the gallery, post it (or cancel at the last step).
- [ ] 20. A link to another website (e.g. in a bio) opens in your normal browser.

## Settings (open with the sliders icon in the toolbar while Instagram is open)

- [ ] 21. Turn **Block Reels** off → back in Instagram the Reels tab is visible again *without* reloading. Turn it on again.
- [ ] 22. Turn **Following feed** off → tapping home shows the normal feed. Turn it back on.
- [ ] 23. Turn **Hide Stories** on → tapping a story shows the blocked screen.
- [ ] 24. Change **Stop the feed** to 10 posts → the card appears after 10.
- [ ] 25. Force-close and reopen: all settings are as you left them.
- [ ] 26. Set **Daily time limit** to 15 min (you can test faster by using the app for 15 minutes or leaving it open).
      The break screen appears; "5 more minutes" works once; "Close" returns to the start screen.

## Rules and leaks

- [ ] 27. Settings → Blocking rules shows a revision and either a successful check or a clear error
      (e.g. "HTTP 404" while the repository is private).
- [ ] 28. Tap the flag on any page → "Leak reported". Settings → Leak reports lists it with rule counts; "Share all" works.

## Edge cases

- [ ] 29. Airplane mode → reload: a "Couldn't load Instagram" screen with "Try again" (no crash).
- [ ] 30. Android back button: goes back inside Instagram, closes the blocked screen, and finally returns to the start screen.
- [ ] 31. Dark mode on the phone: Lite Social's toolbar and screens follow it.
