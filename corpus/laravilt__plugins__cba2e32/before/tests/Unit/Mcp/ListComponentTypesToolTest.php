<?php

use Illuminate\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;
use Laravilt\Plugins\Mcp\Tools\ListComponentTypesTool;

beforeEach(function () {
    $this->tool = new ListComponentTypesTool;
});

test('tool extends base tool class', function () {
    expect($this->tool)->toBeInstanceOf(Tool::class);
});

test('has description property', function () {
    $reflection = new ReflectionClass($this->tool);
    $property = $reflection->getProperty('description');
    $description = $property->getValue($this->tool);

    expect($description)->toBeString()
        ->and($description)->toContain('component types');
});

test('has handle method', function () {
    $reflection = new ReflectionClass($this->tool);
    expect($reflection->hasMethod('handle'))->toBeTrue();
});

test('has schema method', function () {
    $reflection = new ReflectionClass($this->tool);
    expect($reflection->hasMethod('schema'))->toBeTrue();
});

test('handle method returns response', function () {
    $request = Mockery::mock(Request::class);
    $response = $this->tool->handle($request);

    expect($response)->toBeInstanceOf(Response::class);
});

test('schema returns empty array', function () {
    $schema = Mockery::mock(JsonSchema::class);
    $result = $this->tool->schema($schema);

    expect($result)->toBe([]);
});

afterEach(function () {
    Mockery::close();
});
