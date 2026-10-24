#!/usr/bin/env python3
"""Generate a Connect contact flow JSON: natural-speech check-in via Contact Lens.

No Lex. Turns on Contact Lens REAL-TIME speech analytics (which records + transcribes
the customer audio), plays the intro, sets answered=yes, then for each of the 5 questions
plays it and opens an 8-second listening pause (a Get customer input / DTMF block whose
every branch just continues), then plays CLOSING and disconnects. The backend reads the
customer's spoken words from Contact Lens analysis segments after the call.
"""
import json
import uuid

def nid():
    return str(uuid.uuid4())

QUESTIONS = {
    1: "Hi, this is CareCall from County Public Health. If this is an emergency, hang up and "
       "call 911. Checking on you during the power outage. Are you safe right now?",
    2: "Is your medical device working right now?",
    3: "How many full backup tanks or batteries do you have?",
    4: "About how many hours can you go before you run out?",
    5: "Do you need anything else, like medicine, food, a ride, a place to charge, "
       "or an oxygen delivery?",
}
CLOSING = ("Thank you. Our team has your answers. If anything changes or you feel unsafe, "
           "hang up and call 911.")

actions = []
def add(a):
    actions.append(a); return a["Identifier"]

disconnect_id = nid()
add({"Identifier": disconnect_id, "Type": "DisconnectParticipant", "Parameters": {}, "Transitions": {}})
closing_id = nid()
add({"Identifier": closing_id, "Type": "MessageParticipant", "Parameters": {"Text": CLOSING},
     "Transitions": {"NextAction": disconnect_id,
                     "Errors": [{"NextAction": disconnect_id, "ErrorType": "NoMatchingError"}]}})

# Build questions in reverse: each question is the prompt of a listening GetParticipantInput
# (plays the question, then waits 8s for the caller to speak); every exit continues.
next_action = closing_id
for q in reversed(range(1, 6)):
    ask_id = nid()
    add({"Identifier": ask_id, "Type": "GetParticipantInput",
         "Parameters": {"Text": QUESTIONS[q], "StoreInput": "False", "InputTimeLimitSeconds": "8"},
         "Transitions": {"NextAction": next_action,
                         "Errors": [{"NextAction": next_action, "ErrorType": "InputTimeLimitExceeded"},
                                    {"NextAction": next_action, "ErrorType": "NoMatchingCondition"},
                                    {"NextAction": next_action, "ErrorType": "NoMatchingError"}]}})
    next_action = ask_id
first_question = next_action

# answered=yes + intent=CheckIn -> first question
answered_id = nid()
add({"Identifier": answered_id, "Type": "UpdateContactAttributes",
     "Parameters": {"Attributes": {"answered": "yes", "intent": "CheckIn"}},
     "Transitions": {"NextAction": first_question,
                     "Errors": [{"NextAction": first_question, "ErrorType": "NoMatchingError"}]}})

# intro -> answered
intro_id = nid()
add({"Identifier": intro_id, "Type": "MessageParticipant",
     "Parameters": {"Text": "Hello, this is the county CareCall line checking on you during the power outage."},
     "Transitions": {"NextAction": answered_id,
                     "Errors": [{"NextAction": answered_id, "ErrorType": "NoMatchingError"}]}})

# Contact Lens real-time analytics on (records + transcribes customer audio) -> intro
analytics_id = nid()
add({"Identifier": analytics_id, "Type": "UpdateContactRecordingBehavior",
     "Parameters": {
         "RecordingBehavior": {"RecordedParticipants": ["Agent", "Customer"]},
         "AnalyticsBehavior": {
             "Enabled": "True",
             "AnalyticsLanguage": "en-US",
             "AnalyticsMode": "RealTime",
         },
     },
     "Transitions": {"NextAction": intro_id, "Errors": []}})

# set voice -> analytics
voice_id = nid()
add({"Identifier": voice_id, "Type": "UpdateContactTextToSpeechVoice",
     "Parameters": {"TextToSpeechVoice": "Joanna", "TextToSpeechEngine": "Neural"},
     "Transitions": {"NextAction": analytics_id,
                     "Errors": [{"NextAction": analytics_id, "ErrorType": "NoMatchingError"}]}})

print(json.dumps({"Version": "2019-10-30", "StartAction": voice_id, "Actions": actions}))
