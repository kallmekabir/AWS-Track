"""The fixed CareCall questions and emergency phrases."""

# Word for word from docs/RANKING.md, "The call script". Question 1 is also in the
# contact flow's "Get customer input" prompt (connect/SETUP.md); keep them the same.
QUESTIONS = {
    1: "Hi, this is CareCall from County Public Health, checking on you during the power "
       "outage. Are you safe right now?",
    2: "Is your medical device working right now?",
    3: "How many full backup tanks or batteries do you have?",
    4: "About how many hours can you go before you run out?",
    5: "Do you need anything else, like medicine, food, a ride, a place to charge, "
       "or an oxygen delivery?",
}
CLOSING = ("Thank you. Our team has your answers. If anything changes or you feel unsafe, "
           "hang up and call 911.")
EMERGENCY_REPLY = "Please hang up and call 911 now. I'm alerting our medical team."
NOT_HEARD = "Sorry, I didn't catch that. "

# docs/RANKING.md, "Emergency words". Phrases, not single words: a bare "help" would
# end the call when someone answers question 5 with "help with groceries".
EMERGENCY_PHRASES = (
    "can't breathe", "cannot breathe", "can not breathe", "not breathing",
    "chest pain", "heart attack", "emergency", "ambulance", "call 911",
    "nine one one", "help me", "i fell", "i've fallen",
)


def is_emergency(said: str) -> bool:
    text = said.lower().replace("’", "'")
    return any(phrase in text for phrase in EMERGENCY_PHRASES)

