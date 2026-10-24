"""Teammates' phone numbers, kept in AWS Systems Manager Parameter Store.

Each teammate adds their own number in the AWS console (Systems Manager ->
Parameter Store -> Create parameter, tier Standard, type SecureString), named after
the persona they play:

    /carecall/phones/daniel-kim     +14085551234

With PHONES_SSM_PATH=/carecall/phones set, the backend gives those numbers to the
personas and adds them to the dialer allow-list. The numbers never sit in the repo,
in a .env file or in chat, and this code never prints them.
"""
import os
import re
from functools import lru_cache

import boto3

_US_NUMBER = re.compile(r"^\+1\d{10}$")


def slug(name: str) -> str:
    """'Daniel Kim' -> 'daniel-kim', the last part of the parameter name."""
    return name.lower().replace(" ", "-")


def fetch(ssm_client, path: str) -> dict[str, str]:
    """{persona slug: phone} for every parameter directly under `path`."""
    phones = {}
    paginator = ssm_client.get_paginator("get_parameters_by_path")
    for page in paginator.paginate(Path=path, WithDecryption=True):
        for parameter in page["Parameters"]:
            value = parameter["Value"].strip()
            if not _US_NUMBER.match(value):
                # Name the parameter, never echo the value.
                raise ValueError(f"{parameter['Name']} must be a US number like +14085551234")
            phones[parameter["Name"].rsplit("/", 1)[-1]] = value
    return phones


@lru_cache(maxsize=1)
def load() -> dict[str, str]:
    """Teammates' numbers from Parameter Store, read once per process.

    Empty when PHONES_SSM_PATH is not set. Restart the backend after adding a number.
    """
    path = os.getenv("PHONES_SSM_PATH", "").rstrip("/")
    if not path:
        return {}
    return fetch(boto3.client("ssm"), path)
