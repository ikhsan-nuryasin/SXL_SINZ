<?php
namespace Tests\Feature;
use Tests\TestCase;
class SmokeTest extends TestCase { public function test_login_page_is_available(): void { $this->get('/backend/login')->assertOk()->assertSee('TokoOnline'); } }
