"""Stable, caller-safe errors for the MCP service boundary."""


class SpatialServiceError(Exception):
    """Base error with a machine-readable code and safe public message."""

    code = "INTERNAL_ERROR"
    public_message = "The spatial data service could not complete the request."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.public_message)
        if message is not None:
            self.public_message = message


class InvalidArgumentError(SpatialServiceError):
    code = "INVALID_ARGUMENT"


class FeatureNotFoundError(SpatialServiceError):
    code = "FEATURE_NOT_FOUND"


class RepositoryError(SpatialServiceError):
    """Internal adapter failure whose database details must stay server-side."""

    code = "INTERNAL_ERROR"
    public_message = "The spatial data service is temporarily unavailable."

    def __init__(self, internal_message: str | None = None) -> None:
        Exception.__init__(self, internal_message or self.public_message)
