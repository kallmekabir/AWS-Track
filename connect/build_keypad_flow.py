#!/usr/bin/env python3
"""Generate a Connect contact flow JSON: DTMF keypad check-in, no Lex, no Lambda.

Plays the intro, sets answered=yes, asks A1..A5 by keypad, maps each digit to readable
TEXT stored in contact attributes a1..a5 (so Bedrock still reads words), plays CLOSING,
disconnects. Prints the flow JSON to stdout.
"""
import json
import uuid

def nid():
    return str(uuid.uuid4())

CLOSING = ("Thank you. Our team has your answers. If anything changes or you feel unsafe, "
           "hang up and call 911.")
INTRO = ("Hello, this is the county CareCall line checking on you during the power outage. "
         "If this is an emergency, hang up and call 911.")

# Per question: prompt, and digit->text map.
QS = [
    ("a1", "Are you safe right now? Press 1 for yes, 2 for no.",
     {"1": "yes", "2": "no"}),
    ("a2", "Is your medical device working? Press 1 for yes, 2 for no, 3 if not sure.",
     {"1": "yes it is working", "2": "no it is not working", "3": "not sure"}),
    ("a3", "How many full backup tanks or batteries do you have? Press the number.",
     {"0": "0 backups", "1": "1 tank", "2": "2 tanks", "3": "3 tanks",
      "4": "4 tanks", "5": "5 tanks"}),
    ("a4", "About how many hours until you run out? Press the number of hours.",
     {"0": "0 hours", "1": "1 hour", "2": "2 hours", "3": "3 hours", "4": "4 hours",
      "5": "5 hours", "6": "6 hours", "7": "7 hours", "8": "8 hours", "9": "9 hours"}),
    ("a5", "Do you need anything? 1 nothing, 2 a ride, 3 oxygen delivery, "
           "4 a place to charge, 5 food, 6 medicine.",
     {"1": "nothing", "2": "I need a ride", "3": "I need an oxygen delivery",
      "4": "I need a place to charge", "5": "I need food", "6": "I need medicine"}),
]

actions = []

def add(a):
    actions.append(a)
    return a["Identifier"]

# Terminal: closing + disconnect
disconnect_id = nid()
closing_id = nid()

# Build from the end backwards so each block can point to the next.
# Disconnect
add({"Identifier": disconnect_id, "Type": "DisconnectParticipant", "Parameters": {}, "Transitions": {}})
# Closing message -> disconnect
add({"Identifier": closing_id, "Type": "MessageParticipant",
     "Parameters": {"Text": CLOSING},
     "Transitions": {"NextAction": disconnect_id, "Errors": [{"NextAction": disconnect_id, "ErrorType": "NoMatchingError"}]}})

# For each question (reverse), build: GetInput (with inline digit Conditions) -> set-attr -> next
next_action = closing_id
for key, prompt, digit_map in reversed(QS):
    get_id = nid()
    # default (no/invalid input): record "no answer" then continue
    default_set = nid()
    add({"Identifier": default_set, "Type": "UpdateContactAttributes",
         "Parameters": {"Attributes": {key: "no answer"}},
         "Transitions": {"NextAction": next_action,
                         "Errors": [{"NextAction": next_action, "ErrorType": "NoMatchingError"}]}})
    # one Set-attributes block per digit, each -> next_action; condition points here
    conditions = []
    for digit, text in digit_map.items():
        set_id = nid()
        add({"Identifier": set_id, "Type": "UpdateContactAttributes",
             "Parameters": {"Attributes": {key: text}},
             "Transitions": {"NextAction": next_action,
                             "Errors": [{"NextAction": next_action, "ErrorType": "NoMatchingError"}]}})
        conditions.append({"NextAction": set_id,
                           "Condition": {"Operator": "Equals", "Operands": [digit]}})
    # GetParticipantInput (DTMF): digit branches live in Transitions.Conditions.
    add({"Identifier": get_id, "Type": "GetParticipantInput",
         "Parameters": {"Text": prompt, "StoreInput": "False", "InputTimeLimitSeconds": "5"},
         "Transitions": {"NextAction": default_set, "Conditions": conditions,
                         "Errors": [{"NextAction": default_set, "ErrorType": "InputTimeLimitExceeded"},
                                    {"NextAction": default_set, "ErrorType": "NoMatchingCondition"},
                                    {"NextAction": default_set, "ErrorType": "NoMatchingError"}]}})
    next_action = get_id

first_question = next_action

# answered=yes -> first question
answered_id = nid()
add({"Identifier": answered_id, "Type": "UpdateContactAttributes",
     "Parameters": {"Attributes": {"answered": "yes", "intent": "CheckIn"}},
     "Transitions": {"NextAction": first_question,
                     "Errors": [{"NextAction": first_question, "ErrorType": "NoMatchingError"}]}})

# intro message -> answered
intro_id = nid()
add({"Identifier": intro_id, "Type": "MessageParticipant",
     "Parameters": {"Text": INTRO},
     "Transitions": {"NextAction": answered_id,
                     "Errors": [{"NextAction": answered_id, "ErrorType": "NoMatchingError"}]}})

# set voice -> intro
voice_id = nid()
add({"Identifier": voice_id, "Type": "UpdateContactTextToSpeechVoice",
     "Parameters": {"TextToSpeechVoice": "Joanna", "TextToSpeechEngine": "Neural"},
     "Transitions": {"NextAction": intro_id,
                     "Errors": [{"NextAction": intro_id, "ErrorType": "NoMatchingError"}]}})

flow = {
    "Version": "2019-10-30",
    "StartAction": voice_id,
    "Actions": actions,
}
print(json.dumps(flow))
