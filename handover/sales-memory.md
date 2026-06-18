# Teaching the agent what you know: a guide for the Swoop sales team

The discovery agent on Swoop's website carries a set of facts you give it. Tell it something worth remembering and it loads that knowledge into every future visitor conversation. This guide shows you how to log in and do it.

It pairs with [Shaping how the agent behaves](../docs/sales-team-prompt-workflow-sales.md). The quick rule of thumb:

| You want to change... | Use... |
|---|---|
| What the agent **knows** (a fact: seasonality, prices, availability) | This guide. You tell it directly, live. |
| How the agent **behaves** (tone, when it surfaces things, what it asks) | The behaviour guide and the shared Google Doc. |

Adding knowledge is the fast one. A fact takes under a minute, and it's live for the next visitor.

## Logging in

You need a staff login. There are two ways in, and both ask for the same two things.

1. **The staff link.** Open the agent on its direct page (the link your admin gives you, not the chat box embedded in the public website) and add `?swoop_staff_login=1` to the end of the address.
2. **The console fallback.** On that same direct page, open the browser console (right-click, Inspect, Console) and type `swoop_login()`.

Either way, you'll be asked for two things:

- **Your name**, so any change is recorded against you.
- **The staff password.** Ask whoever set the agent up for your team if you don't have it.

You'll see "Staff mode is now active." You stay logged in on that browser for about 30 days. To log in again, or to switch to a different name, run the same step.

One catch: this only works on the agent's **direct page**, not the version embedded inside the public website. Browser privacy rules block the login in the embedded box, so use the direct link.

## Telling the agent to remember something

Once you're logged in, say it in the chat, the way you'd tell a colleague:

> "Remember that the refugios on the W trek are usually fully booked by August for the January season."

The agent shows you exactly what it's about to save and asks you to confirm. **Nothing is saved until you say yes**, so check the wording first. It loads word-for-word into every conversation.

You can also:

- **See what it knows.** "What do you currently remember?"
- **Change a fact.** "Update the refugio note to say September, not August."
- **Remove one.** "Forget the note about X." Nothing is truly deleted, and there's a history, so a mistake is recoverable.

When you're finished, say "done" and it goes back to being the visitor-facing agent.

## What makes a good memory

| Aim for | Why |
|---|---|
| General sales knowledge: seasonality, availability windows, price ranges, operator quirks, regional facts | The kind of thing a specialist knows that the agent should hold in every conversation. |
| Concise and factual | It sits in the agent's working knowledge on every turn. Short and clear beats long and vague. |
| Current | The agent repeats it to every visitor. If it goes out of date, update or remove it. A stale memory misleads everyone, not just one person. |

## The one hard rule

**Never store anything about a specific customer or visitor.** Memory is general knowledge only. It loads into every visitor's conversation, and individual customer details have no place there. "Refugios book out early" is a memory. "The Hendersons want a trip in January" is not. The agent is built to refuse this, but it's on you to hold the line too.

## What it doesn't change

This changes what the agent **knows**, not what it's allowed to do. It still works inside Discover only: it won't build day-by-day itineraries, quote specific prices unprompted, or take bookings. Those stay specialist work, by design. To change how the agent *behaves* rather than what it knows, use the [behaviour guide](../docs/sales-team-prompt-workflow-sales.md).
