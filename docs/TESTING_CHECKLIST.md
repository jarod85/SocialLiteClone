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
- [ ] 12. Paste `https://www.instagram.com/reels/` into a DM to yourself and tap it. You see the "Blocked by Lite
      Social" screen; "Back to Instagram" returns you.
- [ ] 12a. **Watch shared reels** (on by default): a reel someone sent you in a DM opens and plays when tapped.
      On a profile, the Reels tab and reel tiles show and play. Swiping up on a reel never turns into the endless
      Reels viewer. Reels in the home feed are still collapsed.
- [ ] 13. Turn **Watch shared reels** off: the profile Reels tab and reel tiles are hidden, and opening a reel
      from a DM shows the blocked screen. Turn it back on.
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

## Instagram notifications (Android)

- [ ] 20a. Log in to Instagram in Lite Social. Settings → **Instagram notifications** on → allow notifications. A check
      runs right away; the section shows "Messages: OK (N unread)" and "Activity: OK" (or a clear error).
- [ ] 20b. Tap **Allow background checks** and confirm Android's dialog. The button disappears.
- [ ] 20c. Have someone message you, then tap **Check now** (or wait up to 15 minutes with Lite Social closed). A
      notification shows the sender, the message and their picture.
- [ ] 20d. Tap it: Lite Social opens that conversation (not just the inbox). Read it; at the next check the
      notification disappears by itself.
- [ ] 20e. Have someone like or comment on a post: an "Instagram" activity notification appears; tapping it opens your
      activity page in Lite Social.
- [ ] 20f. Log out of Instagram in Lite Social → Check now says "Not logged in". Log back in → OK again.
- [ ] 20g. Turn Instagram notifications off: no more checks or alerts.

## YouTube

- [ ] Y1. Start screen → **YouTube** → "No subscriptions yet". Find channels: search a channel name, tap Subscribe.
- [ ] Y2. Your channels → **Import subscriptions file** → pick Google Takeout's `subscriptions.csv`: "N new channels added".
- [ ] Y3. Back on Subscriptions: newest videos of your channels, newest first, with durations. No Shorts, no
      recommendations. Pull down refreshes.
- [ ] Y4. Open a video: it plays at good quality without any ads. There are no related videos below it.
- [ ] Y5. Press Home (leave the app): the sound keeps playing; the notification has play/pause. Lock the phone: still
      playing; lock-screen controls work.
- [ ] Y6. Back in the app, go back to the feed: the mini player shows; play/pause and × work; tapping it reopens the video.
- [ ] Y7. Download → **Video (MP4)**: a progress notification, then "Saved MP4"; the video is in Gallery → Movies/Lite Social
      and plays with sound.
- [ ] Y8. Download → **Audio (MP3)**: first time it asks for the music folder (pick Musicolet's folder, e.g. Music). Then
      the folder screen: open a subfolder or create one, "Save in …". "Saved MP3" notification; tapping it opens
      Musicolet; the song is in that folder with title, channel and cover art.
- [ ] Y9. Second MP3: the folder screen starts in the subfolder used last time.
- [ ] Y10. In another app (e.g. a chat), tap a YouTube link → "Open with Lite Social" → it plays in Lite Social. A
      Shorts link shows "Shorts are hidden by Lite Social".
- [ ] Y11. Search → Videos: no Shorts among the results.
- [ ] Y12. In a video, tap **Landscape**: full screen, phone sideways. The full-screen button of the player does the same.
      With auto-rotate on, turning the phone upright leaves full screen.
- [ ] Y13. Tap the quality button (shows "Auto · 720p" or similar) → pick 360p: the video carries on from the same spot,
      visibly softer. Open another video: it starts at 360p. Pick **Auto** to go back. Settings → YouTube → Playback
      quality shows the same choice.
- [ ] Y14. Tap **Loop**: it turns "Loop on"; at the end the video starts again. Opening another video turns loop off.

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

## App updates

- [ ] U1. Settings → App updates shows the installed version; "Check for updates" says up to date (or shows the newer one).
- [ ] U2. After publishing a newer release: reopen the app (or Check for updates). The start screen shows "Lite Social X is
      available" → Install update. First time: allow Lite Social to install apps, then Install again.
- [ ] U3. The download progresses, Android's installer opens, Update. Lite Social restarts at the new version with
      Instagram still logged in and settings and YouTube channels kept.
